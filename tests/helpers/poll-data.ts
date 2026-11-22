import type { PollInput } from '../../worker/src/polls/schemas';

export function pollInput(overrides: Partial<PollInput> = {}): PollInput {
  return {
    slug: 'topics',
    title: 'Next talk',
    description: 'Pick **one**.',
    identityMode: 'honor',
    minSelections: 1,
    maxSelections: 1,
    allowWriteIns: true,
    resultsVisibility: 'after_vote',
    startsAt: '2026-09-29T12:00:00.000Z',
    endsAt: '2026-10-30T12:00:00.000Z',
    allowEdits: true,
    editDeadline: null,
    options: ['Robotics', 'Language models'],
    eligibleTags: [],
    ...overrides,
  };
}

export function submission(
  sessionContext: string,
  optionIds: number[],
  expectedRevision = 0,
  writeIn: string | null = null,
) {
  return {
    requestId: crypto.randomUUID(),
    sessionContext,
    expectedRevision,
    optionIds,
    writeIn,
  };
}
