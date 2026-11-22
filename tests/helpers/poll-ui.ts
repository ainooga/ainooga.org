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
export function savedTopic(
  label: string,
  description: string | null = null,
): PollDetail['options'][number] {
  return { id: 3, label, description, origin: 'write_in', position: 2 };
}
export class FakePollRuntime implements PollRuntime {
  openDialog(element: HTMLDialogElement) {
    // jsdom exposes dialog state only. Chromium owns modality, Escape and focus.
    element.setAttribute('open', '');
    return () => element.removeAttribute('open');
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
  switchVoter(email: string, ballot: Ballot | null = null) {
    this.poll = {
      ...this.poll,
      voter: { kind: 'email', value: email },
      sessionContext: (++this.sequence).toString(16).padStart(64, '0'),
      ballot,
    };
  }
  poll = uiPoll();
  submissions: Submission[] = [];
  identifyCalls: { identifier: GuestIdentifier; token: string }[] = [];
  get identifiers() {
    return this.identifyCalls.map((call) => call.identifier);
  }
  identifiedEmail = 'voter@example.com';
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
  async identify(_slug: string, identifier: GuestIdentifier, token: string) {
    this.identifyCalls.push({ identifier, token });
    if (this.failIdentify !== null) throw this.failIdentify;
    this.switchVoter(this.identifiedEmail);
    this.authenticated = true;
  }
  async results(): Promise<PollResults> {
    this.resultsCalls++;
    return this.result;
  }
  result: PollResults = { eligibleCount: 2, ballotCount: 0, options: [] };
  // Script the option returned by the server; never resolve/deduplicate write-ins here.
  savedWriteIn: PollDetail['options'][number] | null = null;
  private accept(input: Submission): Ballot {
    const optionIds = [...input.optionIds];
    if (this.savedWriteIn !== null) {
      this.poll.options.push(this.savedWriteIn);
      optionIds.push(this.savedWriteIn.id);
      this.savedWriteIn = null;
    }
    this.poll.ballot = {
      revision: (this.poll.ballot?.revision ?? 0) + 1,
      optionIds,
      submittedAt: new Date(UI_TIME).toISOString(),
      updatedAt: new Date(UI_TIME).toISOString(),
    };
    return { ...this.poll.ballot, optionIds: [...this.poll.ballot.optionIds] };
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
    return this.accept(input);
  }
  async logout() {
    this.authenticated = false;
  }
}
