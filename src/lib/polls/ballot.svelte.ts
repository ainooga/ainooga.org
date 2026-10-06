import { IdentityConfirmation } from './identity.svelte';
import { PollError } from './types';
import type { Ballot, PollDetail, Submission } from './types';
import type { PollRuntime } from './runtime';
import { canEdit, selectedCount, votingState } from './display';
import { messageFor, type PollPage } from './page.svelte';

export class BallotForm {
  selected = $state<number[]>([]);
  writeIn = $state('');
  writeInDescription = $state('');
  editing = $state(false);
  busy = $state(false);
  message = $state('');
  pending = $state<Submission | null>(null);
  needsReload = $state(false);
  readonly identity = new IdentityConfirmation(this);
  private context = '';
  private revision = 0;
  private alive = true;
  constructor(
    readonly page: PollPage,
    readonly runtime: PollRuntime,
  ) {
    if (page.detail !== null) this.accept(page.detail);
  }
  dispose() {
    this.alive = false;
    this.identity.dispose();
  }
  accept(detail: PollDetail) {
    this.context = detail.sessionContext;
    this.needsReload = false;
    this.identity.open = false;
    this.selected = [...(detail.ballot?.optionIds ?? [])];
    this.revision = detail.ballot?.revision ?? 0;
    this.writeIn = '';
    this.writeInDescription = '';
    this.editing = false;
    this.pending = null;
  }
  select(id: number, single: boolean) {
    const multiple = this.selected.includes(id)
      ? this.selected.filter((value) => value !== id)
      : [...this.selected, id];
    this.selected = single ? [id] : multiple;
    if (single) {
      this.writeIn = '';
      this.writeInDescription = '';
    }
  }
  startEdit() {
    if (this.needsReload) return;
    this.editing = true;
    this.message = '';
  }
  cancel() {
    if (this.page.detail !== null) this.accept(this.page.detail);
    this.message = '';
  }
  async refresh() {
    if (this.busy || this.pending !== null) return;
    this.busy = true;
    const detail = await this.page.refresh();
    if (detail !== null && this.alive) {
      this.accept(detail);
      this.message = '';
    }
    this.busy = false;
  }
  private prepare(): Submission | null {
    const p = this.page.detail;
    if (p === null) return null;
    if (
      votingState(p, this.runtime.now()) !== 'open' ||
      (this.revision > 0 && !canEdit(p, this.runtime.now()))
    ) {
      this.message = 'Voting or ballot editing has closed.';
      return null;
    }
    const fields = this.writeInFields();
    if (fields === null) return null;
    const count = selectedCount(p, this.selected, fields.writeIn ?? '');
    if (
      count < p.minSelections ||
      (p.maxSelections !== null && count > p.maxSelections)
    ) {
      this.message = 'Please follow the selection limits above.';
      return null;
    }
    return {
      requestId: this.runtime.uuid(),
      sessionContext: this.context,
      expectedRevision: this.revision,
      optionIds: [...this.selected],
      ...fields,
    };
  }
  private writeInFields(): Pick<Submission, 'writeIn' | 'writeInDescription'> | null {
    if (this.revision > 0) return { writeIn: null };
    const writeIn = this.writeIn.trim() || null;
    const writeInDescription = this.writeInDescription.trim() || null;
    if (writeIn === null && writeInDescription !== null) {
      this.message = 'Enter a topic for your write-in description.';
      return null;
    }
    return { writeIn, ...(writeInDescription === null ? {} : { writeInDescription }) };
  }
  async submit() {
    if (this.busy || this.needsReload) return;
    const input = this.pending ?? this.prepare();
    if (input === null) return;
    this.pending = input;
    this.busy = true;
    this.message = '';
    try {
      const ballot = await this.page.api.submit(this.page.slug, input);
      await this.saved(ballot);
    } catch (error) {
      if (this.alive) await this.failed(error);
    } finally {
      this.busy = false;
    }
  }
  private async saved(ballot: Ballot) {
    if (!this.alive || this.page.detail === null) return;
    this.accept({ ...this.page.detail, ballot });
    this.page.detail = { ...this.page.detail, ballot };
    this.needsReload = true;
    this.message = 'Your vote is saved.';
    this.page.results = null;
    const detail = await this.page.refresh();
    if (!this.alive) return;
    if (detail !== null) this.accept(detail);
    else this.message = 'Your vote is saved, but its choices could not be loaded.';
  }
  async submitAs(detail: PollDetail) {
    if (this.busy || this.pending === null) return;
    if (detail.ballot !== null && this.pending.writeIn !== null) {
      this.identity.stage = 'confirm';
      this.identity.message =
        'This voter already has a saved vote. Write-ins are only allowed on the first vote. Cancel and reload their ballot to edit selections.';
      return;
    }
    this.pending = {
      ...this.pending,
      requestId: this.runtime.uuid(),
      sessionContext: detail.sessionContext,
      expectedRevision: detail.ballot?.revision ?? 0,
    };
    this.context = detail.sessionContext;
    this.revision = detail.ballot?.revision ?? 0;
    this.page.useVoter(detail);
    await this.submit();
  }
  private async failed(error: unknown) {
    if (error instanceof PollError && error.code === 'session_changed') {
      await this.identity.load();
      return;
    }
    if (!(error instanceof PollError) || error.status === 0 || error.status >= 500) {
      this.message =
        'We could not confirm whether your vote was saved. Retry the same vote to check safely.';
      return;
    }
    if (error.status === 429) {
      this.message = messageFor(error);
      return;
    }
    if ([401, 404, 409].includes(error.status)) {
      await this.reloadAfterFailure(error);
    } else {
      this.pending = null;
      this.identity.open = false;
      this.message = messageFor(error);
    }
  }
  private async reloadAfterFailure(error: PollError) {
    const detail = await this.page.refresh();
    if (!this.alive) return;
    if (detail !== null) this.accept(detail);
    if (detail === null) {
      this.message =
        'Could not reload your saved ballot. Retry to check it before making another submission.';
      return;
    }
    this.message =
      error.status === 409
        ? `${messageFor(error)} Your saved ballot has been reloaded. Review it before submitting again.`
        : messageFor(error);
  }
}
