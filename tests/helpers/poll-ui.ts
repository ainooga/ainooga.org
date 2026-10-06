import type {
  Ballot,
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
    sessionContext: 'a'.repeat(64),
    voter: { kind: 'email', value: 'voter@example.com' },
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
  openDialog(element: HTMLDialogElement) {
    const previous = document.activeElement;
    const parent = element.parentElement;
    element.setAttribute('open', '');
    return () => {
      element.removeAttribute('open');
      queueMicrotask(() => {
        const target =
          previous instanceof HTMLElement &&
          previous !== document.body &&
          previous.isConnected
            ? previous
            : parent?.querySelector<HTMLElement>('button:not(:disabled)');
        target?.focus();
      });
    };
  }
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
  private sequence = 0;
  private ballots = new Map<string, Ballot | null>();
  switchVoter(email: string) {
    this.ballots.set(this.poll.voter.value, this.poll.ballot);
    this.poll = {
      ...this.poll,
      voter: { kind: 'email', value: email },
      sessionContext: (++this.sequence).toString(16).padStart(64, '0'),
      ballot: this.ballots.get(email) ?? null,
    };
  }
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
    if (!['voter@example.com', 'other@example.com', 'chapter.user'].includes(value))
      throw new PollError(403, 'ineligible', 'Not eligible');
    this.switchVoter(value === 'chapter.user' ? 'voter@example.com' : value);
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
    if (input.sessionContext !== this.poll.sessionContext)
      throw new PollError(409, 'session_changed', 'Your voter identity changed.');
    const ids = [...input.optionIds];
    if (input.writeIn !== null) {
      if (this.poll.ballot !== null)
        throw new PollError(
          409,
          'write_in_first_vote_only',
          'Write-ins are only allowed on your first vote.',
        );
      const id = this.poll.options.length + 1;
      this.poll.options.push({
        id,
        label: input.writeIn,
        description: input.writeInDescription ?? null,
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
