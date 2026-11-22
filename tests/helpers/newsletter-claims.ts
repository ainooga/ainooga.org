import type { DbClient } from '../../worker/src/types';

/** Newsletter handler seam. SQL normalization, atomicity and redemption belong to D1. */
export class NewsletterClaims implements Pick<
  DbClient,
  'insertSubscriber' | 'invalidateConfirmation'
> {
  pending = new Map<string, string>();
  attempts: string[] = [];
  invalidated: string[] = [];

  async insertSubscriber(address: string, _name: string | null, token: string) {
    this.attempts.push(address);
    if (this.pending.has(address)) return false;
    this.pending.set(address, token);
    return true;
  }
  async invalidateConfirmation(token: string) {
    this.invalidated.push(token);
    for (const [address, claim] of this.pending) {
      if (claim === token) this.pending.delete(address);
    }
  }
}
