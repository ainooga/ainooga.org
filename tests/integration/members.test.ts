// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { memberFixture, memberInput } from '../helpers/members';
let f: Awaited<ReturnType<typeof memberFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('previews without writes and imports all member relationships repeatably', async () => {
  f = await memberFixture();
  const before = await f.store.query('SELECT * FROM people ORDER BY id');
  const preview = await f.importMember(memberInput(), true);
  expect(preview.status).toBe(200);
  const proposed = await preview.json();
  expect(await f.store.query('SELECT * FROM people ORDER BY id')).toEqual(before);
  expect(await f.store.query('SELECT * FROM events')).toEqual([]);
  const applied = await f.importMember(memberInput());
  expect(applied.status).toBe(200);
  expect(await applied.json()).toEqual(proposed);
  expect(await f.store.query("SELECT tag FROM person_tags WHERE tag='member'")).toEqual([
    { tag: 'member' },
  ]);
  expect(await f.store.query('SELECT kind,status FROM subscriptions')).toEqual([
    { kind: 'event_invites', status: 'unknown' },
  ]);
  expect(
    await f.store.query(
      'SELECT registration_status,attendance_status,registered_at FROM event_participation',
    ),
  ).toEqual([
    {
      registration_status: 'approved',
      attendance_status: 'unknown',
      registered_at: null,
    },
  ]);
  expect(await f.store.query('SELECT allowed_person_ids FROM polls ORDER BY id')).toEqual(
    [
      { allowed_person_ids: '[2]' },
      { allowed_person_ids: '[2]' },
      { allowed_person_ids: '[3]' },
    ],
  );
  const repeat = await f.importMember(memberInput());
  expect(repeat.status).toBe(200);
  expect(
    (await repeat.json()).actions.every(
      (a: { action: string }) => a.action === 'unchanged',
    ),
  ).toBe(true);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  expect(await f.store.query('PRAGMA foreign_key_check')).toEqual([]);
});

it('serializes concurrent duplicates without orphaned people or events', async () => {
  f = await memberFixture();
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => f.importMember(memberInput())),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  for (const table of [
    'events',
    'event_links',
    'organizations',
    'organization_people',
    'person_sources',
    'event_participation',
  ]) {
    expect(await f.store.query(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 1 }]);
  }
});
