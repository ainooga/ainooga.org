// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('requires organizer tokens on every management path and preserves readiness isolation', async () => {
  f = await pollFixture();
  await f.create();
  for (const [suffix, method] of [
    ['', 'POST'],
    ['', 'GET'],
    ['/topics', 'PUT'],
    ['/topics', 'GET'],
    ['/topics/publish', 'POST'],
    ['/topics/archive', 'POST'],
    ['/topics/allowlist', 'POST'],
    ['/topics/allowlist', 'GET'],
    ['/topics/results', 'GET'],
    ['/topics/ballots', 'GET'],
  ]) {
    for (const token of ['', 'b'.repeat(64)]) {
      const response = await f.request(
        `/api/admin/polls${suffix}`,
        method,
        method === 'GET' ? undefined : pollInput(),
        { Authorization: `Bearer ${token}` },
      );
      expect(response.status).toBe(401);
    }
  }
});
it('gates new routes only, rejects foreign origins and limits requests', async () => {
  f = await pollFixture();
  f.env.POLLS_READY = 'false';
  expect((await f.admin()).status).toBe(503);
  expect((await f.request('/api/polls/honor/access')).status).toBe(503);
  expect((await f.request('/api/polls/honor/session')).status).toBe(200);
  expect(
    (
      await f.request('/api/admin/me', 'GET', undefined, {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
      })
    ).status,
  ).toBe(200);
  f.env.POLLS_READY = 'true';
  expect(
    (
      await f.request('/api/admin/polls', 'POST', pollInput(), {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
        Origin: 'https://evil.test',
      })
    ).status,
  ).toBe(403);
  f.deps.allowed = false;
  expect((await f.admin()).status).toBe(429);
});
it('exposes only login requirements anonymously and never another voter identity', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  expect(await (await f.request('/api/polls/topics/access')).json()).toEqual({
    identityMode: 'honor',
    methods: ['honor'],
  });
  for (const suffix of ['', '/ballot', '/results']) {
    const r = await f.request(`/api/polls/topics${suffix}`);
    expect(r.status).toBe(401);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.text()).not.toContain('Next talk');
  }
  const detail = await (
    await f.request('/api/polls/topics', 'GET', undefined, { Cookie: cookie })
  ).text();
  expect(JSON.parse(detail).voter).toEqual({ kind: 'email', value: 'voter@example.com' });
  expect(Object.keys(JSON.parse(detail).voter).sort()).toEqual(['kind', 'value']);
  for (const secret of [
    'personId',
    'person_id',
    'other@example.com',
    'created_by',
    'eligibleTags',
    'eligibleCount',
  ])
    expect(detail).not.toContain(secret);
  await f.create(pollInput({ slug: 'draft' }));
  expect((await f.request('/api/polls/draft/access')).status).toBe(404);
  expect(
    (await f.request('/api/polls/draft', 'GET', undefined, { Cookie: cookie })).status,
  ).toBe(404);
  expect(
    (await f.request('/api/polls/other', 'GET', undefined, { Cookie: cookie })).status,
  ).toBe(401);
  expect(
    (await f.request('/api/polls/topics/ballots', 'GET', undefined, { Cookie: cookie }))
      .status,
  ).toBe(404);
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        { ...submission([]), personId: 3 },
        { Cookie: cookie },
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', submission([]), {
        Cookie: cookie,
        Origin: 'https://evil.test',
      })
    ).status,
  ).toBe(403);
});
it('omits unconfigured Discord and bounds/validates organizer JSON', async () => {
  f = await pollFixture();
  f.env.DISCORD_CLIENT_ID = undefined;
  expect(await (await f.request('/api/polls/verified/access')).json()).toEqual({
    identityMode: 'verified',
    methods: ['email'],
  });
  for (const input of [
    { ...pollInput(), status: 'published' },
    pollInput({ description: 'x'.repeat(17000) }),
    pollInput({ options: [' Same ', 'same'] }),
  ])
    expect([400, 413]).toContain((await f.admin('', 'POST', input)).status);
  const r = await handleAuth(
    new Request(`${SITE}/api/admin/polls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: '{}',
    }),
    f.env,
    f.deps,
    f.deps,
  );
  expect(r.status).toBe(415);
});
