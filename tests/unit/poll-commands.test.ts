// @vitest-environment node
import { expect, it } from 'vitest';
import { runPollCommand, pollOutput } from '../../scripts/polls/commands';

it.each([
  [['show', 'topics'], ['/topics']],
  [
    ['publish', 'topics'],
    ['/topics/publish', 'POST', {}],
  ],
  [['results', 'topics'], ['/topics/results']],
  [['ballots', 'topics'], ['/topics/ballots']],
  [
    ['archive', 'topics'],
    ['/topics/archive', 'POST', {}],
  ],
] as const)(
  'routes %j without replaying the server lifecycle',
  async (args, expected) => {
    const calls: unknown[] = [];
    const response = { marker: 'returned by API' };
    expect(
      await runPollCommand([...args], {
        async request(...args) {
          calls.push(args);
          return response;
        },
      }),
    ).toBe(response);
    expect(calls).toEqual([expected]);
  },
);

it('returns success for a fully accepted invitation and refuses malformed summaries', async () => {
  const summary = { recipients: 2, accepted: 2, failed: 0 };
  const args = ['invite', 'topics'];
  const calls: unknown[] = [];
  const invoke = (result: unknown) =>
    pollOutput(args, {
      async request(...args) {
        calls.push(args);
        return result;
      },
    });
  expect(await invoke(summary)).toEqual({ result: summary, exitCode: 0 });
  await expect(invoke({ recipients: 2 })).rejects.toThrow();
  expect(calls).toEqual([
    ['/topics/invite', 'POST', {}],
    ['/topics/invite', 'POST', {}],
  ]);
});
