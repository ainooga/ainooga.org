import type { MemberInput } from '../members/schemas.js';
import { applyMember } from './apply.js';
import { authenticatedSource, type SyncEnvType } from './session.js';
import {
  active,
  claim,
  finish,
  guarded,
  release,
  renew,
  SyncError,
  type SyncLeaseType,
} from './state.js';

export interface MemberSourceType {
  roster(): Promise<string[]>;
  member(email: string): Promise<MemberInput>;
}
export interface SyncDependenciesType {
  db: D1Database;
  now(): number;
  random(): number;
  source(lease: SyncLeaseType): Promise<MemberSourceType>;
}

async function processChunk(lease: SyncLeaseType, deps: SyncDependenciesType) {
  if (lease.now() - lease.started_at > 6 * 3600000) throw new SyncError('run_expired');
  const source = await deps.source(lease);
  if (lease.roster === null) {
    lease.roster = JSON.stringify(await source.roster());
    const result = await guarded(
      lease,
      `UPDATE member_sync_state SET roster=? WHERE id=1 AND ${active}`,
      [lease.roster],
    ).run();
    if (!result.meta.changes) throw new SyncError('lease_lost');
  }
  const emails = JSON.parse(lease.roster) as string[];
  for (const email of emails.slice(lease.cursor, lease.cursor + 10)) {
    await renew(lease);
    const member = await source.member(email);
    await applyMember(lease, member);
  }
  const done = lease.cursor === emails.length;
  if (done) await finish(lease, deps.random(), null);
  return {
    status: done ? 'complete' : 'processing',
    applied: lease.cursor,
    expected: emails.length,
  };
}

export async function syncTick(deps: SyncDependenciesType) {
  const lease = await claim(deps.db, deps.now);
  if (!lease) return { status: 'idle' };
  try {
    return await processChunk(lease, deps);
  } catch (error) {
    const code = error instanceof SyncError ? error.code : 'sync_failed';
    if (code !== 'lease_lost') await finish(lease, deps.random(), code);
    throw new SyncError(code);
  } finally {
    await release(lease);
  }
}

export default {
  async scheduled(_event: ScheduledController, env: SyncEnvType): Promise<void> {
    try {
      const result = await syncTick({
        db: env.DB,
        now: Date.now,
        random: Math.random,
        source: (lease) => authenticatedSource(lease, env),
      });
      if (result.status !== 'idle')
        console.log(JSON.stringify({ event: 'member_sync', ...result }));
    } catch (error) {
      const code = error instanceof SyncError ? error.code : 'sync_failed';
      console.error(JSON.stringify({ event: 'member_sync_failed', code }));
      throw new Error(code);
    }
  },
};
