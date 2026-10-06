// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';

let f: Awaited<ReturnType<typeof pollFixture>>;
beforeEach(async () => {
  f = await pollFixture();
});
afterEach(async () => {
  await f?.dispose();
});

it('creates normalized email allowances atomically and lets the invited person vote', async () => {
  const input = {
    ...pollInput(),
    eligibleEmails: [' VOTER@example.com ', 'guest@example.com', 'GUEST@example.com'],
  };
  expect((await f.create(input)).status).toBe(201);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibleEmails: ['guest@example.com', 'voter@example.com'],
    eligibility: { eligibleCount: 2 },
  });
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  for (const table of ['person_tags', 'subscriptions'])
    expect(await f.store.query(`SELECT * FROM ${table}`)).toEqual([]);
  await f.admin('/topics/publish', 'POST', {});
  expect(
    (
      await f.request('/api/polls/topics/auth/honor', 'POST', {
        identifier: { kind: 'email', value: 'guest@example.com' },
        turnstileToken: 'bot',
      })
    ).status,
  ).toBe(200);
  expect(
    (await f.create({ ...input, eligibleEmails: ['unwanted@example.com'] })).status,
  ).toBe(409);
  expect(
    await f.store.query(
      "SELECT * FROM person_identifiers WHERE normalized_value='unwanted@example.com'",
    ),
  ).toEqual([]);
});

it('preserves omitted allowances and replaces supplied allowances on drafts and published polls', async () => {
  await f.create({ ...pollInput(), eligibleEmails: ['voter@example.com'] });
  expect((await f.admin('/topics', 'PUT', pollInput({ title: 'Changed' }))).status).toBe(
    200,
  );
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibleEmails: ['voter@example.com'],
  });
  expect(
    (
      await f.admin('/topics', 'PUT', {
        ...pollInput(),
        eligibleEmails: ['other@example.com'],
      })
    ).status,
  ).toBe(200);
  await f.admin('/topics/publish', 'POST', {});
  expect(
    (
      await f.admin('/topics', 'PUT', {
        ...pollInput({ title: 'Published edit' }),
        eligibleEmails: ['guest@example.com'],
      })
    ).status,
  ).toBe(200);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    title: 'Published edit',
    eligibleEmails: ['guest@example.com'],
  });
  expect(
    (await f.admin('/topics', 'PUT', { ...pollInput(), eligibleEmails: [] })).status,
  ).toBe(200);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    eligibleEmails: [],
    eligibility: { eligibleCount: 0 },
  });
  await f.admin('/topics/archive', 'POST', {});
  expect(
    (
      await f.admin('/topics', 'PUT', {
        ...pollInput(),
        eligibleEmails: ['blocked@example.com'],
      })
    ).status,
  ).toBe(409);
  expect(
    await f.store.query(
      "SELECT * FROM person_identifiers WHERE normalized_value='blocked@example.com'",
    ),
  ).toEqual([]);
});

it('rolls back the definition and new identities when an allowance write fails', async () => {
  await f.store.execute([
    `CREATE TRIGGER block_test_email BEFORE INSERT ON person_identifiers
    WHEN NEW.normalized_value='blocked@example.com' BEGIN SELECT RAISE(ABORT,'test failure'); END`,
  ]);
  expect(
    (
      await f.create({
        ...pollInput(),
        eligibleEmails: ['new@example.com', 'blocked@example.com'],
      })
    ).status,
  ).toBe(500);
  expect(await f.store.query("SELECT * FROM polls WHERE slug='topics'")).toEqual([]);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 3 }]);
  await f.create({ ...pollInput(), eligibleEmails: ['voter@example.com'] });
  expect(
    (
      await f.admin('/topics', 'PUT', {
        ...pollInput({ title: 'Must roll back' }),
        eligibleEmails: ['blocked@example.com'],
      })
    ).status,
  ).toBe(500);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    title: 'Next talk',
    eligibleEmails: ['voter@example.com'],
  });
});
