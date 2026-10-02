import { PollError } from './types';
import type { GuestIdentifier, PollDetail, PollResults, PollService } from './types';
import { canSeeResults } from './display';

export class PollPage {
  phase = $state<
    | 'loading'
    | 'email'
    | 'discord'
    | 'sorry'
    | 'poll'
    | 'missing'
    | 'unsupported'
    | 'error'
  >('loading');
  detail = $state<PollDetail | null>(null);
  results = $state<PollResults | null>(null);
  message = $state('');
  resultsError = $state('');
  busy = $state(false);
  private generation = 0;
  constructor(
    readonly slug: string,
    readonly api: PollService,
  ) {}
  dispose() {
    this.generation++;
  }
  private clear() {
    this.detail = null;
    this.results = null;
    this.resultsError = '';
  }

  async load() {
    const generation = ++this.generation;
    this.phase = 'loading';
    this.message = '';
    this.clear();
    try {
      const access = await this.api.access(this.slug);
      if (generation !== this.generation) return;
      if (access.identityMode !== 'honor') {
        this.phase = 'unsupported';
        return;
      }
      const detail = await this.api.detail(this.slug);
      if (generation !== this.generation) return;
      this.detail = detail;
      this.phase = 'poll';
      await this.loadResults(generation);
    } catch (error) {
      if (generation === this.generation) this.failure(error);
    }
  }
  private failure(error: unknown) {
    this.generation++;
    if (error instanceof PollError && error.status === 401) {
      this.clear();
      this.phase = 'email';
      this.message = 'Enter an eligible email to access this poll.';
    } else if (error instanceof PollError && error.status === 404) {
      this.clear();
      this.phase = 'missing';
    } else {
      this.phase = 'error';
      this.message = messageFor(error);
    }
  }
  async identify(identifier: GuestIdentifier, token: string) {
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true;
    this.message = '';
    try {
      await this.api.identify(this.slug, identifier, token);
      if (generation === this.generation) await this.load();
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof PollError && error.code === 'ineligible') {
        this.phase = identifier.kind === 'email' ? 'discord' : 'sorry';
      } else if (error instanceof PollError && error.status === 404) this.failure(error);
      else this.message = messageFor(error);
    } finally {
      this.busy = false;
    }
  }
  async logout() {
    if (this.busy) return;
    ++this.generation;
    this.busy = true;
    this.clear();
    this.phase = 'loading';
    try {
      await this.api.logout();
      this.message = '';
      this.phase = 'email';
    } catch {
      this.phase = 'error';
      this.message = 'Could not sign out. Retry signing out before changing identity.';
    } finally {
      this.busy = false;
    }
  }
  async refresh(): Promise<PollDetail | null> {
    const generation = this.generation;
    try {
      const detail = await this.api.detail(this.slug);
      if (generation !== this.generation) return null;
      this.detail = detail;
      this.message = '';
      await this.loadResults(generation);
      return generation === this.generation ? detail : null;
    } catch (error) {
      if (generation === this.generation) {
        if (error instanceof PollError && [401, 404].includes(error.status))
          this.failure(error);
        else this.message = messageFor(error);
      }
      return null;
    }
  }
  async loadResults(generation = this.generation) {
    this.results = null;
    this.resultsError = '';
    if (this.detail === null || !canSeeResults(this.detail)) return;
    try {
      const results = await this.api.results(this.slug);
      if (generation === this.generation) this.results = results;
    } catch (error) {
      if (generation === this.generation) this.resultsFailure(error);
    }
  }
  private resultsFailure(error: unknown) {
    if (error instanceof PollError && [401, 404].includes(error.status))
      this.failure(error);
    else if (error instanceof PollError && error.code === 'hidden_results')
      this.resultsError = 'Results are not available to this voter.';
    else this.resultsError = messageFor(error);
  }
  retryEmail() {
    this.phase = 'email';
    this.message = '';
  }
}
export function messageFor(error: unknown): string {
  if (error instanceof PollError && error.status === 429)
    return 'Too many attempts. Wait one minute and try again.';
  if (error instanceof PollError && error.status === 503)
    return 'Polls are temporarily unavailable. Please try again shortly.';
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}
