// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { authFixture, responseCookie } from '../helpers/auth';
import { migration } from '../helpers/d1';
import { verifyLive } from '../../db/migrate';
let f: Awaited<ReturnType<typeof authFixture>>;
afterEach(async () => {
  await f?.dispose();
});
it('upgrades populated 0003 without altering polls, ballots, eligibility or sessions', async () => {
  f = await authFixture();
  const login = await f.call('/api/polls/honor/auth/honor', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  await f.store.execute([
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
  await expect(verifyLive(f.store)).rejects.toThrow('poll_eligible_tags');
  await migration(f.store, '0004_poll_api.sql');
  await expect(verifyLive(f.store)).resolves.toBeUndefined();
  expect(
    await Promise.all(tables.map((table) => f.store.query(`SELECT * FROM ${table}`))),
  ).toEqual(before);
  expect(
    await (
      await f.call('/api/polls/honor/session', undefined, responseCookie(login))
    ).json(),
  ).toMatchObject({ authenticated: true, personId: 2 });
  await expect(
    f.store.execute(["INSERT INTO poll_eligible_tags VALUES (1,'INVALID')"]),
  ).rejects.toThrow();
  await expect(
    f.store.execute([
      `INSERT INTO poll_submission_receipts VALUES (1,3,'request','${'a'.repeat(64)}','${'b'.repeat(64)}')`,
    ]),
  ).rejects.toThrow();
});
