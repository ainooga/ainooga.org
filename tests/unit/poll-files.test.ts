// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEligibility, readPoll } from '../../scripts/polls/files';
import { runPollCommand } from '../../scripts/polls/commands';
import { PollClient } from '../../scripts/polls/client';
import { pollSchema } from '../../worker/src/polls/schemas';
import { pollInput } from '../helpers/polls';
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function file(text: string) {
  directory ??= await mkdtemp(join(tmpdir(), 'poll-files-'));
  const path = join(directory, 'input.md');
  await writeFile(path, text);
  return path;
}
it('parses committed examples and validates without API access', async () => {
  const input = await readPoll('docs/polls/topic-vote.md');
  expect(input).toMatchObject({
    eligibleTags: [],
    description: expect.stringContaining('**up to two**'),
  });
  expect(await readEligibility('docs/polls/eligible-voters.yml')).toHaveLength(3);
  const result = await runPollCommand(['validate', 'docs/polls/topic-vote.md'], {
    async request() {
      throw new Error('Must be offline');
    },
  });
  expect(result).toEqual({ valid: true, slug: 'topic-vote' });
});
it.each([
  '---js\nthrow new Error("executed")\n---',
  '---javascript\nthrow new Error("executed")\n---',
  '---json\n{}\n---',
  'Missing frontmatter',
  '---\ntitle: Missing closing delimiter',
])('rejects non-YAML or malformed delimiters: %s', async (text) => {
  directory = undefined;
  await expect(readPoll(await file(text))).rejects.toThrow('standalone ---');
});
it('reports filename and field, rejects unquoted dates and unknown fields', async () => {
  directory = undefined;
  const example = await readFile('docs/polls/topic-vote.md', 'utf8');
  for (const text of [
    example.replace('minSelections: 1', 'minSelections: 0'),
    example.replace('title:', 'unrecognized:'),
  ]) {
    const path = await file(text);
    await expect(readPoll(path)).rejects.toThrow(path);
  }
  await expect(
    readPoll(
      await file(example.replace(/^(startsAt|endsAt): ['"]([^'"]+)['"]$/gm, '$1: $2')),
    ),
  ).rejects.toThrow('startsAt');
});
it('validates the entire eligibility file before calls, and reports partial batches', async () => {
  directory = undefined;
  let calls = 0;
  const api = {
    async request() {
      calls++;
      if (calls === 2) throw new Error('offline');
      return {};
    },
  };
  const list = Array.from(
    { length: 51 },
    (_, i) => `- kind: email\n  value: voter${i}@example.com`,
  ).join('\n');
  const path = await file(`${list}\n- kind: email\n  value: invalid`);
  await expect(runPollCommand(['allowlist', 'add', 'topics', path], api)).rejects.toThrow(
    '[51].value',
  );
  expect(calls).toBe(0);
  await writeFile(path, list);
  await expect(runPollCommand(['allowlist', 'add', 'topics', path], api)).rejects.toThrow(
    '50 confirmed entries',
  );
  expect(calls).toBe(2);
});
it.each([
  { endsAt: '2026-09-29T11:00:00Z' },
  { minSelections: 3 },
  { maxSelections: 0 },
  { editDeadline: '2026-09-29T12:00:00Z' },
  { allowEdits: false, editDeadline: '2026-09-29T13:00:00Z' },
  { eligibleTags: ['MixedCase'] },
  { eligibleTags: ['a', 'a'] },
  { options: [' X ', 'x'] },
])('rejects invalid poll configuration %j', (patch) => {
  expect(pollSchema.safeParse(pollInput(patch)).success).toBe(false);
});
it.each([
  'http://example.com',
  'ftp://localhost',
  'https://name:secret@example.com',
  'https://example.com/path',
  'https://example.com/?secret=1',
])('refuses unsafe API origin %s', (url) => {
  expect(() => new PollClient('a'.repeat(64), url)).toThrow();
});
