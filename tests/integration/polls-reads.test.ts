// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput, submission } from '../helpers/polls';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});
it.each(['', '/ballot'])('does not aggregate results for the %s read', async (suffix) => {
  f = await pollFixture();
  const cookie = await f.ready();
  f.prepared.length = 0;
  expect(
    (await f.request(`/api/polls/topics${suffix}`, 'GET', undefined, { Cookie: cookie }))
      .status,
  ).toBe(200);
  expect(
    f.prepared.some(
      (sql) => sql.includes('count(v.option_id)') || sql.includes('AS ballotCount'),
    ),
  ).toBe(false);
  if (suffix === '/ballot')
    expect(f.prepared.some((sql) => sql.includes('FROM poll_options'))).toBe(false);
});
it.each(['never', 'after_vote'] as const)(
  'does not aggregate denied %s results',
  async (resultsVisibility) => {
    f = await pollFixture();
    const cookie = await f.ready(pollInput({ resultsVisibility }));
    f.prepared.length = 0;
    expect(
      (await f.request('/api/polls/topics/results', 'GET', undefined, { Cookie: cookie }))
        .status,
    ).toBe(403);
    expect(f.prepared.some((sql) => sql.includes('count(v.option_id)'))).toBe(false);
  },
);
it('still computes permitted results', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Choice'), {
    Cookie: cookie,
  });
  f.prepared.length = 0;
  expect(
    await (
      await f.request('/api/polls/topics/results', 'GET', undefined, { Cookie: cookie })
    ).json(),
  ).toMatchObject({ ballotCount: 1 });
  expect(f.prepared.some((sql) => sql.includes('count(v.option_id)'))).toBe(true);
});
