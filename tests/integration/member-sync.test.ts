// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { memberInput } from '../helpers/members';
import { deferred } from '../helpers/background';
import { syncTick, type SyncDependenciesType } from '../../worker/src/member-sync/index';
import { applyMember } from '../../worker/src/member-sync/apply';
import { claim, leaseMilliseconds, release } from '../../worker/src/member-sync/state';

let f: Awaited<ReturnType<typeof authFixture>>;
let deps: SyncDependenciesType;
let now: number;
let members = [input(0)];
let failEmail: string | null;
function input(index: number) {
  const email = `sync${index}@example.com`;
  return {
    ...memberInput(),
    source: 'ai_collective',
    sourceKey: email,
    email,
    participations: [],
  };
}
const state = async () => (await f.store.query('SELECT * FROM member_sync_state'))[0]!;
const tick = () => syncTick(deps);
async function due() {
  now = Number((await state()).next_run_at);
}

beforeEach(async () => {
  f = await authFixture();
  now = Date.parse('2026-10-10T12:00:00Z');
  members = [input(0)];
  failEmail = null;
  deps = {
    db: f.db,
    now: () => now,
    random: () => 0.5,
    source: async () => ({
      roster: async () => members.map((m) => m.sourceKey),
      member: async (email) => {
        if (email === failEmail) throw new Error('Private source failure');
        return structuredClone(members.find((m) => m.sourceKey === email)!);
      },
    }),
  };
});
afterEach(async () => {
  await f?.dispose();
});

it('checkpoints ten members per tick and repeats without duplicating data', async () => {
  members = Array.from({ length: 12 }, (_, i) => input(i));
  expect(await tick()).toEqual({ status: 'processing', applied: 10, expected: 12 });
  expect((await state()).cursor).toBe(10);
  expect(await tick()).toEqual({ status: 'complete', applied: 12, expected: 12 });
  const finished = await state();
  expect(finished.roster).toBeNull();
  expect(finished.next_run_at).toBe(now + 5 * 3600000);
  expect(await tick()).toEqual({ status: 'idle' });
  const tables = [
    'people',
    'person_identifiers',
    'person_tags',
    'organizations',
    'organization_people',
    'subscriptions',
  ];
  const before = await Promise.all(
    tables.map((t) => f.store.query(`SELECT * FROM ${t}`)),
  );
  await due();
  await tick();
  await tick();
  expect(
    await Promise.all(tables.map((t) => f.store.query(`SELECT * FROM ${t}`))),
  ).toEqual(before);
  expect(
    await f.store.query(
      "SELECT count(*) n FROM person_sources WHERE source='ai_collective'",
    ),
  ).toEqual([{ n: 12 }]);
}, 30000);

it('updates source scalars while preserving opt-outs, verified contacts, and absent members', async () => {
  await tick();
  const person = (
    await f.store.query(
      "SELECT person_id FROM person_sources WHERE source='ai_collective'",
    )
  )[0]!.person_id;
  await f.store.execute([
    `UPDATE subscriptions SET subscribed=0,unsubscribed_at='2026-01-01T00:00:00.000Z' WHERE person_id=${person}`,
    `UPDATE person_identifiers SET verified_at='2026-01-01T00:00:00.000Z' WHERE person_id=${person}`,
    `INSERT INTO person_tags VALUES(${person},'local')`,
  ]);
  const identifiers = await f.store.query('SELECT * FROM person_identifiers');
  Object.assign(members[0]!, {
    name: 'Updated',
    professionalRole: null,
    phone: null,
    linkedin: null,
    company: null,
    tags: [],
  });
  await due();
  await tick();
  expect(
    await f.store.query(`SELECT name,professional_role FROM people WHERE id=${person}`),
  ).toEqual([{ name: 'Updated', professional_role: null }]);
  expect(await f.store.query('SELECT * FROM person_identifiers')).toEqual(identifiers);
  expect(
    await f.store.query(`SELECT subscribed FROM subscriptions WHERE person_id=${person}`),
  ).toEqual([{ subscribed: 0 }]);
  expect(
    await f.store.query(
      `SELECT tag FROM person_tags WHERE person_id=${person} ORDER BY tag`,
    ),
  ).toEqual([{ tag: 'local' }, { tag: 'member' }, { tag: 'volunteer' }]);
  members = [];
  await due();
  expect(await tick()).toEqual({ status: 'complete', applied: 0, expected: 0 });
  expect(await f.store.query(`SELECT name FROM people WHERE id=${person}`)).toEqual([
    { name: 'Updated' },
  ]);
});

it('records partial failure and schedules a fresh retry without exposing source errors', async () => {
  members = [input(0), input(1)];
  failEmail = members[1]!.email;
  await expect(tick()).rejects.toThrow('sync_failed');
  expect(await state()).toMatchObject({
    cursor: 1,
    roster: null,
    last_error: 'sync_failed',
    last_finished_at: now,
    next_run_at: now + 5 * 3600000,
  });
  failEmail = null;
  await due();
  expect(await tick()).toEqual({ status: 'complete', applied: 2, expected: 2 });
  expect((await state()).last_error).toBeNull();
  expect(
    await f.store.query(
      "SELECT count(*) n FROM person_sources WHERE source='ai_collective'",
    ),
  ).toEqual([{ n: 2 }]);
});

it('rejects a conflicting identity without modifying that person', async () => {
  members[0] = {
    ...input(0),
    email: 'voter@example.com',
    sourceKey: 'voter@example.com',
  };
  await f.store.execute([
    "INSERT INTO person_sources(person_id,source,source_key) VALUES(2,'ai_collective','different')",
  ]);
  await expect(tick()).rejects.toThrow('identity_conflict');
  expect((await state()).cursor).toBe(0);
  expect(await f.store.query('SELECT name FROM people WHERE id=2')).toEqual([
    { name: 'Voter' },
  ]);
});

it('rolls back a member when its checkpoint fails', async () => {
  await f.store.execute([
    `CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF cursor ON member_sync_state
    WHEN NEW.cursor > OLD.cursor BEGIN SELECT RAISE(ABORT,'private failure'); END`,
  ]);
  await expect(tick()).rejects.toThrow('sync_failed');
  expect((await state()).cursor).toBe(0);
  expect(
    await f.store.query(
      "SELECT count(*) n FROM person_sources WHERE source='ai_collective'",
    ),
  ).toEqual([{ n: 0 }]);
});

it('excludes concurrent invocations and rejects writes from an expired lease', async () => {
  const gate = deferred();
  const entered = deferred();
  const original = deps.source;
  deps.source = async (lease) => {
    entered.resolve();
    await gate.promise;
    return original(lease);
  };
  const first = tick();
  await entered.promise;
  expect(await tick()).toEqual({ status: 'idle' });
  gate.resolve();
  await first;
  await due();
  const stale = (await claim(f.db, deps.now))!;
  now += leaseMilliseconds + 1;
  const current = (await claim(f.db, deps.now))!;
  const people = await f.store.query('SELECT * FROM people');
  await expect(applyMember(stale, { ...input(0), name: 'stale' })).rejects.toThrow(
    'lease_lost',
  );
  expect(await f.store.query('SELECT * FROM people')).toEqual(people);
  expect((await state()).lease_token).toBe(current.token);
  await release(current);
});

it('abandons an expired roster instead of applying old data', async () => {
  members = Array.from({ length: 12 }, (_, i) => input(i));
  await tick();
  now += 6 * 3600000 + 1;
  await expect(tick()).rejects.toThrow('run_expired');
  expect(await state()).toMatchObject({
    cursor: 10,
    roster: null,
    last_error: 'run_expired',
  });
});
