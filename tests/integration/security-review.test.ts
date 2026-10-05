// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { ORGANIZER_TOKEN } from '../helpers/auth';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
  vi.restoreAllMocks();
});

it('rejects voter cookies and malformed credentials on every organizer operation without writes', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const paths = [
    ['GET', '/api/admin/me'],
    ['POST', '/api/admin/members/import'],
    ['POST', '/api/admin/members/import/preview'],
    ['POST', '/api/admin/people/2/identifiers'],
    ['GET', '/api/admin/polls'],
    ['POST', '/api/admin/polls'],
    ['GET', '/api/admin/polls/topics'],
    ['PUT', '/api/admin/polls/topics'],
    ['POST', '/api/admin/polls/topics/publish'],
    ['POST', '/api/admin/polls/topics/archive'],
    ['GET', '/api/admin/polls/topics/allowlist'],
    ['POST', '/api/admin/polls/topics/allowlist'],
    ['GET', '/api/admin/polls/topics/results'],
    ['GET', '/api/admin/polls/topics/ballots'],
  ];
  const before = await f.store.query('SELECT id,status FROM polls ORDER BY id');
  for (const [method, path] of paths) {
    for (const authorization of [
      '',
      `Bearer ${ORGANIZER_TOKEN} trailing`,
      `Basic ${ORGANIZER_TOKEN}`,
      `Bearer ${'b'.repeat(64)}`,
    ]) {
      const response = await f.request(
        path!,
        method!,
        method === 'GET' ? undefined : pollInput(),
        { Cookie: cookie, Authorization: authorization },
      );
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  }
  expect(await f.store.query('SELECT id,status FROM polls ORDER BY id')).toEqual(before);
  expect(await f.store.query('SELECT count(*) AS n FROM person_identifiers')).toEqual([
    { n: 3 },
  ]);
});

it('rejects organizer tokens as voter proof and foreign or absent mutation origins', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  for (const suffix of ['', '/ballot', '/results']) {
    expect(
      (
        await f.request(`/api/polls/topics${suffix}`, 'GET', undefined, {
          Authorization: `Bearer ${ORGANIZER_TOKEN}`,
        })
      ).status,
    ).toBe(401);
  }
  for (const origin of ['', 'null', 'https://evil.test']) {
    expect(
      (
        await f.request(
          '/api/polls/topics/ballot',
          'PUT',
          {},
          { Cookie: cookie, Origin: origin },
        )
      ).status,
    ).toBe(403);
  }
});

it('redacts private exceptions in responses and application diagnostics', async () => {
  f = await pollFixture();
  const captured: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    captured.push(args);
  });
  f.deps.limit = async () => {
    throw new Error(`private@example.com ${ORGANIZER_TOKEN}`);
  };
  const response = await f.admin();
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({
    error: 'Something went wrong.',
    code: 'internal',
    requestId: expect.any(String),
  });
  expect(captured).toEqual([
    [JSON.stringify({ event: 'api_error', requestId: body.requestId })],
  ]);
});
