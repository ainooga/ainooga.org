// @vitest-environment node
import { expect, it } from 'vitest';
import { normalizeMember, normalizeRoster } from '../../worker/src/member-sync/source';
import { nextRunAt } from '../../worker/src/member-sync/state';

const detail = {
  email: ' Member@Example.com ',
  allChapterIds: ['other', 'chattanooga'],
  name: ' Example Member ',
  role: null,
  company: '',
  phone: '+1 (555) 010-0100',
  linkedin: '/in/example',
  unsubscribedFromInvites: false,
  unsubscribedAt: null,
  notes: 'Do not retain this',
  signups: [{ private: 'Do not retain this either' }],
};

it('projects only member fields and retains the existing source identity', () => {
  expect(normalizeMember(detail, ['Volunteer'], 'member@example.com')).toEqual({
    source: 'ai_collective',
    sourceKey: 'member@example.com',
    email: 'Member@Example.com',
    name: 'Example Member',
    professionalRole: null,
    company: null,
    phone: '+1 (555) 010-0100',
    linkedin: '/in/example',
    tags: ['volunteer'],
    eventInvites: { subscribed: true, unsubscribedAt: null },
    participations: [],
  });
});

it.each([
  { email: 'different@example.com' },
  { allChapterIds: ['other'] },
  { phone: 'not a phone' },
  { name: undefined },
  { unsubscribedFromInvites: 'false' },
  { unsubscribedAt: '2026-01-01T00:00:00Z' },
])('rejects invalid or contradictory details without leaking values: %j', (change) => {
  expect(() =>
    normalizeMember({ ...detail, ...change }, [], 'member@example.com'),
  ).toThrow('source_invalid');
});

it('accepts cross-chapter members but rejects an incomplete or duplicate roster', () => {
  const members = [{ email: detail.email, allChapterIds: detail.allChapterIds }];
  expect(normalizeRoster({ members, nextCursor: null }, 1)).toEqual([
    'member@example.com',
  ]);
  for (const input of [
    { members, nextCursor: 'cursor' },
    { members: [...members, ...members], nextCursor: null },
    { members: [{ ...members[0], allChapterIds: ['other'] }], nextCursor: null },
    {
      members: Array.from({ length: 1000 }, (_, i) => ({
        email: `m${i}@example.com`,
        allChapterIds: ['chattanooga'],
      })),
      nextCursor: null,
    },
  ])
    expect(() => normalizeRoster(input, input.members.length)).toThrow('source_invalid');
  expect(() => normalizeRoster({ members }, 2)).toThrow('source_invalid');
});

it('chooses a persisted minute within four to six hours of completion', () => {
  const finished = Date.parse('2026-10-10T12:00:31.321Z');
  for (const random of [0, 0.5, 0.999999]) {
    const due = nextRunAt(finished, random);
    expect(due % 60000).toBe(0);
    expect(due - finished).toBeGreaterThanOrEqual(4 * 3600000);
    expect(due - finished).toBeLessThanOrEqual(6 * 3600000);
  }
});
