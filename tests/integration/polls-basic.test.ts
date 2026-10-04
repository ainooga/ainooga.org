// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture } from '../helpers/polls';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});
it('creates, publishes, authenticates, votes, retries, edits and returns aggregate results', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const details = await f.request('/api/polls/topics', 'GET', undefined, {
    Cookie: cookie,
  });
  expect(details.status).toBe(200);
  const poll = (await details.json()) as { options: { id: number }[] };
  const first = submission([poll.options[0]!.id]);
  const vote = () =>
    f.request('/api/polls/topics/ballot', 'PUT', first, { Cookie: cookie });
  expect(await (await vote()).json()).toMatchObject({
    revision: 1,
    optionIds: first.optionIds,
  });
  expect(await (await vote()).json()).toMatchObject({ revision: 1 });
  const edit = submission([], 1, 'New talk');
  expect(
    await (
      await f.request('/api/polls/topics/ballot', 'PUT', edit, { Cookie: cookie })
    ).json(),
  ).toMatchObject({ revision: 2 });
  expect((await vote()).status).toBe(409);
  expect(await (await f.admin('/topics/results')).json()).toMatchObject({
    ballotCount: 1,
    eligibleCount: 1,
    options: expect.arrayContaining([
      expect.objectContaining({ label: 'New talk', votes: 1 }),
    ]),
  });
});
