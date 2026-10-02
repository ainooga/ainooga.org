import type {
  Access,
  GuestIdentifier,
  PollDetail,
  PollResults,
  PollService,
  Submission,
} from '../../src/lib/polls/types';
import { PollError } from '../../src/lib/polls/types';
import type { PollRuntime } from '../../src/lib/polls/runtime';

export const UI_TIME = Date.parse('2026-10-02T12:00:00Z');
export function uiPoll(overrides: Partial<PollDetail> = {}): PollDetail {
  return {
    slug: 'topics',
    title: 'Choose a topic',
    description: 'Pick **your favorite**.',
    identityMode: 'honor',
    minSelections: 1,
    maxSelections: 1,
    allowWriteIns: true,
    resultsVisibility: 'after_vote',
    startsAt: '2026-10-01T12:00:00Z',
    endsAt: '2026-10-03T12:00:00Z',
    allowEdits: true,
    editDeadline: null,
    options: [
      { id: 1, label: 'Robotics', origin: 'predefined', position: 0 },
      { id: 2, label: 'Language models', origin: 'predefined', position: 1 },
    ],
    ballot: null,
    ...overrides,
  };
}
export class FakePollRuntime implements PollRuntime {
  focus(element: HTMLElement) {
    element.focus();
  }
  time = UI_TIME;
  sequence = 0;
  callbacks = new Set<() => void>();
  now() {
    return this.time;
  }
  uuid() {
    return `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`;
  }
  everySecond(callback: () => void) {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
  advance(milliseconds: number) {
    this.time += milliseconds;
    for (const callback of this.callbacks) callback();
  }
}
export class FakePollService implements PollService {
  authenticated = false;
  poll = uiPoll();
  submissions: Submission[] = [];
  identifiers: GuestIdentifier[] = [];
  failSubmit: PollError | null = null;
  failIdentify: PollError | null = null;
  failDetail: PollError | null = null;
  resultsCalls = 0;
  async access(): Promise<Access> {
    return { identityMode: this.poll.identityMode, methods: ['honor'] };
  }
  async detail() {
    if (this.failDetail !== null) throw this.failDetail;
    if (!this.authenticated)
      throw new PollError(401, 'login_required', 'Enter an eligible email.');
    return JSON.parse(JSON.stringify(this.poll)) as PollDetail;
  }
  async identify(_slug: string, identifier: GuestIdentifier, _token: string) {
    this.identifiers.push(identifier);
    if (this.failIdentify !== null) throw this.failIdentify;
    const value = identifier.value.trim().toLowerCase();
    if (!['voter@example.com', 'chapter.user'].includes(value))
      throw new PollError(403, 'ineligible', 'Not eligible');
    this.authenticated = true;
  }
  async results(): Promise<PollResults> {
    this.resultsCalls++;
    if (this.poll.resultsVisibility === 'never')
      throw new PollError(403, 'hidden_results', 'Hidden');
    return {
      eligibleCount: 2,
      ballotCount: this.poll.ballot === null ? 0 : 1,
      options: this.poll.options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: Number(this.poll.ballot?.optionIds.includes(o.id) ?? false),
      })),
    };
  }
  async submit(_slug: string, input: Submission) {
    this.submissions.push(JSON.parse(JSON.stringify(input)) as Submission);
    if (this.failSubmit !== null) {
      const error = this.failSubmit;
      this.failSubmit = null;
      throw error;
    }
    const ids = [...input.optionIds];
    if (input.writeIn !== null) {
      const id = this.poll.options.length + 1;
      this.poll.options.push({
        id,
        label: input.writeIn,
        origin: 'write_in',
        position: id,
      });
      ids.push(id);
    }
    this.poll.ballot = {
      revision: input.expectedRevision + 1,
      optionIds: ids,
      submittedAt: new Date(UI_TIME).toISOString(),
      updatedAt: new Date(UI_TIME).toISOString(),
    };
    return { ...this.poll.ballot, optionIds: [...this.poll.ballot.optionIds] };
  }
  async logout() {
    this.authenticated = false;
  }
}
