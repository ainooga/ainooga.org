// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { responseCookie } from '../helpers/auth';

let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('grants and removes tag-based access live while retaining accepted ballots', async () => {
  f = await pollFixture();
  await f.store.execute(["INSERT INTO person_tags VALUES(2,'member')"]);
  await f.create(pollInput({ eligibleTags: ['member'] }));
  expect((await f.admin('/topics/publish', 'POST')).status).toBe(200);
  const login = () =>
    f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'voter@example.com' },
      turnstileToken: 'bot',
    });
  const cookie = responseCookie(await login());
  const submission = await f.ballotFor(cookie);
  const headers = { Cookie: cookie };
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        submission([], 0, 'Choice'),
        headers,
      )
    ).status,
  ).toBe(200);
  await f.store.execute(['DELETE FROM person_tags WHERE person_id=2']);
  expect((await login()).status).toBe(403);
  for (const path of ['', '/ballot', '/results'])
    expect(
      (await f.request(`/api/polls/topics${path}`, 'GET', undefined, headers)).status,
    ).toBe(401);
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        submission([], 1, 'Choice'),
        headers,
      )
    ).status,
  ).toBe(401);
  expect(await (await f.admin('/topics/results')).json()).toMatchObject({
    eligibleCount: 0,
    ballotCount: 1,
  });
  expect(await f.store.query('SELECT revision FROM poll_ballots')).toEqual([
    { revision: 1 },
  ]);
  await f.store.execute(["INSERT INTO person_tags VALUES(2,'member')"]);
  expect((await login()).status).toBe(200);
  expect((await f.request('/api/polls/topics', 'GET', undefined, headers)).status).toBe(
    200,
  );
});

it('keeps concurrent explicit additions and rejects obsolete revoke actions', async () => {
  f = await pollFixture();
  await f.create();
  const responses = await Promise.all(
    ['voter@example.com', 'other@example.com'].map((value) =>
      f.admin('/topics/allowlist', 'POST', {
        action: 'add',
        identifiers: [{ kind: 'email', value }],
      }),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await (await f.admin('/topics/allowlist')).json()).toEqual([
    expect.objectContaining({ personId: 2 }),
    expect.objectContaining({ personId: 3 }),
  ]);
  expect(
    (
      await f.admin('/topics/allowlist', 'POST', {
        action: 'revoke',
        identifiers: [{ kind: 'email', value: 'voter@example.com' }],
      })
    ).status,
  ).toBe(400);
});

it('round-trips plain-text descriptions alongside string choices and freezes them on publish', async () => {
  f = await pollFixture();
  const options = ['Robotics', { label: 'Language models', description: '<b>Text</b>' }];
  const cookie = await f.ready(pollInput({ options }));
  expect(await (await f.admin('/topics')).json()).toMatchObject({ options });
  const detail = await f.request('/api/polls/topics', 'GET', undefined, {
    Cookie: cookie,
  });
  expect(await detail.json()).toMatchObject({
    options: [
      { label: 'Robotics', description: null },
      { label: 'Language models', description: '<b>Text</b>' },
    ],
  });
  expect(
    (await f.admin('/topics', 'PUT', pollInput({ options, title: 'Updated' }))).status,
  ).toBe(200);
  expect(
    (
      await f.admin(
        '/topics',
        'PUT',
        pollInput({
          options: ['Robotics', { label: 'Language models', description: 'Changed' }],
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await f.create(
        pollInput({
          slug: 'invalid',
          options: [{ label: 'Text', description: 'x'.repeat(1001) }],
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.create(
        pollInput({
          slug: 'duplicate',
          options: ['Text', { label: ' TEXT ', description: 'Different' }],
        }),
      )
    ).status,
  ).toBe(400);
});
