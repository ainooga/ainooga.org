// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { migration } from '../helpers/d1';
import { verifyLive } from '../../db/migrate';
import { hashToken } from '../../worker/src/auth/crypto';
let f: Awaited<ReturnType<typeof authFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('keeps an existing voter session usable after the current migration', async () => {
  f = await authFixture(false);
  const token = 'b'.repeat(64);
  const hash = await hashToken(token);
  await f.store.execute([
    `INSERT INTO voter_sessions VALUES('${hash}',2,2,'voter@example.com','honor',1,'2026-01-01','2027-01-01')`,
  ]);
  await migration(f.store, '0004_poll_api.sql');
  await migration(f.store, '0005_simplify_chapter.sql');
  await migration(f.store, '0006_member_sync.sql');
  await verifyLive(f.store);
  expect(
    await (
      await f.call('/api/polls/honor/session', undefined, `__Host-ainooga-honor=${token}`)
    ).json(),
  ).toMatchObject({ authenticated: true, personId: 2 });
});
it('upgrades populated 0003 without altering polls, ballots, eligibility or sessions', async () => {
  f = await authFixture(false);
  await f.store.execute([
    "INSERT INTO voter_sessions VALUES('session',2,2,'voter@example.com','honor',1,'2026-01-01','2027-01-01')",
    "INSERT INTO poll_options (id,poll_id,label,normalized_label,origin) VALUES (1,1,'Option','option','predefined')",
    'INSERT INTO poll_ballots (id,poll_id,person_id) VALUES (1,1,2)',
    'INSERT INTO poll_ballot_choices VALUES (1,1,1)',
  ]);
  const tables = [
    'people',
    'person_identifiers',
    'polls',
    'poll_allowlist',
    'poll_options',
    'poll_ballots',
    'poll_ballot_choices',
    'voter_sessions',
  ];
  const before = await Promise.all(
    tables.map((table) => f.store.query(`SELECT * FROM ${table}`)),
  );
  await expect(verifyLive(f.store)).rejects.toThrow('current schema');
  await migration(f.store, '0004_poll_api.sql');
  expect(
    await Promise.all(tables.map((table) => f.store.query(`SELECT * FROM ${table}`))),
  ).toEqual(before);
  await expect(
    f.store.execute(["INSERT INTO poll_eligible_tags VALUES (1,'INVALID')"]),
  ).rejects.toThrow();
  await expect(
    f.store.execute([
      `INSERT INTO poll_submission_receipts VALUES (1,3,'request','${'a'.repeat(64)}','${'b'.repeat(64)}')`,
    ]),
  ).rejects.toThrow();
});
