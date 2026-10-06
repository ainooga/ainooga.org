// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});
const ids = (action: 'add' | 'remove', ...values: string[]) => ({
  action,
  identifiers: values.map((value) => ({ kind: 'email', value })),
});

it('uses live tag eligibility and removes only explicit allowances', async () => {
  f = await pollFixture();
  await f.store.execute([
    "INSERT INTO person_tags VALUES (2,'chapter'),(2,'volunteer'),(3,'chapter')",
  ]);
  expect(
    (await f.create(pollInput({ eligibleTags: ['chapter', 'volunteer'] }))).status,
  ).toBe(201);
  expect(
    (await f.admin('/topics/allowlist', 'POST', ids('add', 'Voter@Example.com'))).status,
  ).toBe(200);
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'discord', value: '123456789012345678' }],
  });
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibility: { eligibleCount: 2 },
  });
  await f.admin('/topics/allowlist', 'POST', ids('remove', 'other@example.com'));
  expect(await (await f.admin('/topics/publish', 'POST')).json()).toMatchObject({
    status: 'published',
    eligibility: { eligibleCount: 2 },
  });
  await f.store.execute([
    'DELETE FROM person_tags WHERE person_id=2',
    "INSERT INTO person_tags VALUES (1,'chapter')",
  ]);
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(200);
  expect(await (await f.admin('/topics/allowlist')).json()).toEqual([
    expect.objectContaining({ personId: 2 }),
  ]);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibility: { eligibleCount: 3 },
  });
  await f.admin('/topics/allowlist', 'POST', ids('remove', 'voter@example.com'));
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibility: { eligibleCount: 2 },
  });
});
it('creates unverified people idempotently without membership, consent or access grants', async () => {
  f = await pollFixture();
  await f.create();
  const input = ids('add', 'New@Example.com', 'new@example.com');
  await Promise.all([
    f.admin('/topics/allowlist', 'POST', input),
    f.admin('/topics/allowlist', 'POST', input),
  ]);
  expect(
    await f.store.query(
      "SELECT count(*) AS n FROM person_identifiers WHERE normalized_value='new@example.com' AND verified_at IS NULL",
    ),
  ).toEqual([{ n: 1 }]);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  for (const table of ['person_tags', 'subscriptions'])
    expect(await f.store.query(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
  expect(
    (await f.admin('/topics/allowlist', 'POST', ids('remove', 'unknown@example.com')))
      .status,
  ).toBe(400);
  expect(
    (
      await f.admin(
        '/topics/allowlist',
        'POST',
        ids('add', ...Array(51).fill('voter@example.com')),
      )
    ).status,
  ).toBe(400);
});
it('rejects invalid publication and preserves drafts on duplicate create', async () => {
  f = await pollFixture();
  await f.create(pollInput({ eligibleTags: ['missing'] }));
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(409);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    status: 'draft',
    eligibility: { missingTags: ['missing'] },
  });
  expect((await f.create(pollInput({ title: 'overwrite' }))).status).toBe(409);
  expect(await (await f.admin('/topics')).json()).toMatchObject({ title: 'Next talk' });
  await f.admin('/topics', 'PUT', pollInput());
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(409);
  await f.admin('/topics/allowlist', 'POST', ids('add', 'voter@example.com'));
  await f.setTime('2026-11-01T00:00:00Z');
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(409);
});
it('freezes published rules, permits text edits, and archives terminally', async () => {
  f = await pollFixture();
  await f.ready();
  expect(
    (await f.admin('/topics', 'PUT', pollInput({ title: 'New title' }))).status,
  ).toBe(200);
  for (const patch of [
    { maxSelections: 2 },
    { eligibleTags: ['new'] },
    { options: ['Different'] },
    { identityMode: 'verified' as const },
    { resultsVisibility: 'before_vote' as const },
    { allowEdits: false },
    { startsAt: '2026-09-28T12:00:00.000Z' },
  ])
    expect((await f.admin('/topics', 'PUT', pollInput(patch))).status).toBe(409);
  expect((await f.admin('/topics/archive', 'POST')).status).toBe(200);
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(409);
  expect((await f.admin('/topics', 'PUT', pollInput())).status).toBe(409);
  expect(
    (await f.admin('/topics/allowlist', 'POST', ids('add', 'voter@example.com'))).status,
  ).toBe(409);
  expect((await f.request('/api/polls/topics/access')).status).toBe(404);
  expect((await f.admin('/topics/ballots')).status).toBe(200);
});
