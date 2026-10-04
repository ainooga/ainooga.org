import type { PollDetail } from './types';
import type { BallotForm } from './ballot.svelte';
import { messageFor } from './page.svelte';

export class IdentityConfirmation {
  open = $state(false);
  stage = $state<'confirm' | 'email' | 'submitting'>('confirm');
  target = $state<PollDetail | null>(null);
  busy = $state(false);
  message = $state('');
  private alive = true;
  constructor(private form: BallotForm) {}
  dispose() {
    this.alive = false;
  }
  dismiss() {
    if (this.busy || this.form.busy) return;
    // A rejected identity mismatch is safe to abandon. An uncertain write is not.
    if (this.stage !== 'submitting') this.form.pending = null;
    this.open = false;
    this.target = null;
  }
  async load() {
    this.open = true;
    this.stage = 'confirm';
    this.target = null;
    this.message = '';
    this.busy = true;
    try {
      const detail = await this.form.page.api.detail(this.form.page.slug);
      if (this.alive) this.target = detail;
    } catch (error) {
      if (this.alive && !this.form.page.handleAccessError(error))
        this.message = messageFor(error);
    } finally {
      this.busy = false;
    }
  }
  async confirm() {
    if (this.busy || this.target === null) return;
    this.stage = 'submitting';
    await this.form.submitAs(this.target);
  }
  async enterEmail(value: string, proof: string) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    const email = value.trim().toLowerCase();
    try {
      const { api, slug } = this.form.page;
      await api.identify(slug, { kind: 'email', value: email }, proof);
      const detail = await api.detail(slug);
      if (!this.alive) return;
      this.target = detail;
      this.stage = 'confirm';
      this.busy = false;
      if (detail.voter.kind === 'email' && detail.voter.value === email)
        await this.confirm();
    } catch (error) {
      if (this.alive && !this.form.page.handleAccessError(error))
        this.message = messageFor(error);
    } finally {
      this.busy = false;
    }
  }
}
