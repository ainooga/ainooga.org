import { PollError } from './types';
import type { PollDetail, Submission } from './types';
import type { PollRuntime } from './runtime';
import { canEdit, selectedCount, votingState } from './display';
import { messageFor, type PollPage } from './page.svelte';

export class BallotForm {
  selected = $state<number[]>([]);
  writeIn = $state('');
  editing = $state(false);
  busy = $state(false);
  message = $state('');
  pending = $state<Submission | null>(null);
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
  }
  accept(detail: PollDetail) {
    this.selected = [...(detail.ballot?.optionIds ?? [])];
    this.revision = detail.ballot?.revision ?? 0;
    this.writeIn = '';
    this.editing = false;
    this.pending = null;
  }
  select(id: number, single: boolean) {
    const multiple = this.selected.includes(id)
      ? this.selected.filter((value) => value !== id)
      : [...this.selected, id];
    this.selected = single ? [id] : multiple;
    if (single) this.writeIn = '';
  }
  startEdit() {
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
    if (detail !== null && this.alive) this.accept(detail);
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
    const count = selectedCount(p, this.selected, this.writeIn);
    if (
      count < p.minSelections ||
      (p.maxSelections !== null && count > p.maxSelections)
    ) {
      this.message = 'Please follow the selection limits above.';
      return null;
    }
    return {
      requestId: this.runtime.uuid(),
      expectedRevision: this.revision,
      optionIds: [...this.selected],
      writeIn: this.writeIn.trim() || null,
    };
  }
  async submit() {
    if (this.busy) return;
    const input = this.pending ?? this.prepare();
    if (input === null) return;
    this.pending = input;
    this.busy = true;
    this.message = '';
    try {
      const ballot = await this.page.api.submit(this.page.slug, input);
      if (!this.alive || this.page.detail === null) return;
      this.accept({ ...this.page.detail, ballot });
      this.page.detail = { ...this.page.detail, ballot };
      this.message = 'Your vote is saved.';
      await this.page.refresh();
    } catch (error) {
      if (this.alive) await this.failed(error);
    } finally {
      this.busy = false;
    }
  }
  private async failed(error: unknown) {
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
    } else {
      this.pending = null;
      this.message = messageFor(error);
    }
  }
}
