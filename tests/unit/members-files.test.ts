// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberInput } from '../helpers/members';
import { readMembers, validateFile } from '../../scripts/members/files';
import { runMemberCommand } from '../../scripts/members/commands';
import { MemberClient, type MemberApi } from '../../scripts/members/client';
import {
  memberSchema,
  linkedinUrl,
  normalizePhone,
} from '../../worker/src/members/schemas';
import { summarize } from '../../scripts/members/summary';
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function file(content: string) {
  directory ??= await mkdtemp(join(tmpdir(), 'member-input-'));
  const path = join(directory, 'input.json');
  await writeFile(path, content);
  return path;
}

it('rejects invalid files, duplicate identities, and contradictory shared events before API access', async () => {
  const first = memberInput();
  expect(() => validateFile([first, first])).toThrow('Row 2: duplicate');
  const second = { ...memberInput(), email: 'second@example.com' };
  expect(() => validateFile([first, second])).toThrow('duplicate');
  second.sourceKey = 'second';
  second.participations[0]!.event.capacity = 99;
  expect(() => validateFile([first, second])).toThrow('conflicting event');
  expect(() => validateFile([{ ...first, name: 'x'.repeat(16384) }])).toThrow('16 KiB');
  await expect(readMembers(await file('not JSON private@example.com'))).rejects.toThrow(
    'valid JSON',
  );
  await expect(readMembers(await file('[]'))).rejects.toThrow('Invalid member fields');
  await expect(readMembers(await file(' '.repeat(5 * 1024 * 1024 + 1)))).rejects.toThrow(
    '5 MiB',
  );
});

it('validates offline and stops import before writes when any preview conflicts or fails', async () => {
  directory = undefined;
  const path = await file(
    JSON.stringify([
      memberInput(),
      { ...memberInput(), email: 'second@example.com', sourceKey: 'second' },
    ]),
  );
  const calls: boolean[] = [];
  const api: MemberApi = {
    async request(_input, preview) {
      calls.push(preview);
      return { actions: [], conflicts: ['identity_conflict'] };
    },
  };
  expect(await runMemberCommand(['validate', path], api)).toMatchObject({ members: 2 });
  expect(calls).toEqual([]);
  expect(await runMemberCommand(['preview', path], api)).toMatchObject({ conflicts: 2 });
  await expect(runMemberCommand(['import', path], api)).rejects.toThrow('rows 1, 2');
  expect(calls.every(Boolean)).toBe(true);
  api.request = async () => {
    throw new Error('private@example.com');
  };
  await expect(runMemberCommand(['preview', path], api)).rejects.toThrow(
    'Preview failed at row 1',
  );
  await expect(runMemberCommand(['unknown', path], api)).rejects.toThrow('Usage:');
  await expect(runMemberCommand([], api)).rejects.toThrow('Usage:');
});

it.each([
  '',
  'http://example.com',
  'https://user:password@example.com',
  'https://example.com/path',
  'https://example.com/?token=private',
  'https://example.com/#fragment',
])('rejects an unsafe or ambiguous API destination %s', (url) => {
  expect(() => new MemberClient('a'.repeat(64), url)).toThrow();
});
it('requires a valid token and bounds outgoing requests', async () => {
  expect(() => new MemberClient('bad', 'https://example.com')).toThrow(
    'AINOOGA_API_TOKEN',
  );
  const client = new MemberClient('a'.repeat(64), 'https://example.com');
  await expect(
    client.request({ ...memberInput(), name: 'x'.repeat(17000) }, false),
  ).rejects.toThrow('16 KiB');
});

it('normalizes contact values without inventing verification or a country code', () => {
  expect(normalizePhone('(555) 010-0100')).toBe('5550100100');
  expect(linkedinUrl('/in/synthetic')).toBe('https://www.linkedin.com/in/synthetic');
  expect(linkedinUrl('https://LINKEDIN.COM/in/Case')).toBe(
    'https://linkedin.com/in/Case',
  );
  const input = memberInput();
  for (const linkedin of [
    'https://user:pass@linkedin.com/in/x',
    'https://linkedin.com:444/in/x',
    '//evil.test/in/x',
    'not a URL',
    'https://linkedin.com/',
  ])
    expect(memberSchema.safeParse({ ...input, linkedin }).success).toBe(false);
  for (const url of [
    'not-a-url',
    'http://event.test',
    'https://user:password@event.test',
  ])
    expect(
      memberSchema.safeParse({
        ...input,
        participations: [
          {
            ...input.participations[0],
            event: { ...input.participations[0]!.event, url },
          },
        ],
      }).success,
    ).toBe(false);
  expect(
    memberSchema.safeParse({
      ...input,
      participations: [
        {
          ...input.participations[0],
          event: { ...input.participations[0]!.event, timezone: 'invalid' },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    memberSchema.safeParse({
      ...input,
      eventInvites: { subscribed: true, unsubscribedAt: '2026-01-01T00:00:00.000Z' },
    }).success,
  ).toBe(false);
});

it('requires a boolean invitation preference and rejects contradictory opt-out dates', () => {
  for (const subscribed of [true, false])
    expect(
      memberSchema.safeParse({
        ...memberInput(),
        eventInvites: { subscribed, unsubscribedAt: null },
      }).success,
    ).toBe(true);
  for (const subscribed of ['true', 'false', 0, 1, null])
    expect(
      memberSchema.safeParse({
        ...memberInput(),
        eventInvites: { subscribed, unsubscribedAt: null },
      }).success,
    ).toBe(false);
});

it('deduplicates event changes and reports preserved fields without private values', () => {
  const input = memberInput();
  const result = {
    actions: [
      { field: 'participations.0.event.location', action: 'fill' as const },
      { field: 'name', action: 'preserve' as const },
    ],
    conflicts: [],
  };
  expect(summarize([input, input], [result, result])).toMatchObject({
    events: 1,
    changes: { fill: 1, preserve: 2 },
    issues: [
      { row: 1, field: 'name', code: 'preserved_existing' },
      { row: 2, field: 'name', code: 'preserved_existing' },
    ],
  });
  expect(() =>
    summarize(
      [input],
      [
        {
          actions: [{ field: 'participations.25.event', action: 'create' }],
          conflicts: [],
        },
      ],
    ),
  ).toThrow('Invalid event index');
});
