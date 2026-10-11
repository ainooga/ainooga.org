import type { D1Database } from '@cloudflare/workers-types';

export class SyncError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface SyncLeaseType {
  db: D1Database;
  token: string;
  now(): number;
  roster: string | null;
  cursor: number;
  started_at: number;
}

export const leaseMilliseconds = 5 * 60000;
export const active = 'EXISTS (SELECT 1 FROM sync_guard)';

export function nextRunAt(finishedAt: number, random: number): number {
  const earliest = Math.ceil((finishedAt + 4 * 3600000) / 60000);
  const latest = Math.floor((finishedAt + 6 * 3600000) / 60000);
  return (earliest + Math.floor(random * (latest - earliest + 1))) * 60000;
}

export function fence(lease: SyncLeaseType) {
  return {
    sql: `EXISTS (SELECT 1 FROM member_sync_state WHERE id=1 AND lease_token=? AND lease_until>?)`,
    values: [lease.token, lease.now()] as (string | number)[],
  };
}

export function guarded(
  lease: SyncLeaseType,
  sql: string,
  values: (string | number | null)[] = [],
) {
  const guard = fence(lease);
  return lease.db
    .prepare(`WITH sync_guard AS (SELECT 1 WHERE ${guard.sql}) ${sql}`)
    .bind(...guard.values, ...values);
}

export async function claim(
  db: D1Database,
  now: () => number,
): Promise<SyncLeaseType | null> {
  const token = crypto.randomUUID();
  const time = now();
  const row = await db
    .prepare(
      `UPDATE member_sync_state SET lease_token=?,lease_until=?,
    cursor=CASE WHEN roster IS NULL THEN 0 ELSE cursor END,started_at=COALESCE(started_at,?)
    WHERE id=1 AND lease_until<=? AND (roster IS NOT NULL OR next_run_at<=?)
    RETURNING roster,cursor,started_at`,
    )
    .bind(token, time + leaseMilliseconds, time, time, time)
    .first<Pick<SyncLeaseType, 'roster' | 'cursor' | 'started_at'>>();
  return row ? { db, token, now, ...row } : null;
}

export async function renew(lease: SyncLeaseType): Promise<void> {
  const result = await guarded(
    lease,
    `UPDATE member_sync_state SET lease_until=? WHERE id=1 AND ${active}`,
    [lease.now() + leaseMilliseconds],
  ).run();
  if (!result.meta.changes) throw new SyncError('lease_lost');
}

export async function release(lease: SyncLeaseType): Promise<void> {
  await guarded(
    lease,
    `UPDATE member_sync_state SET lease_until=0,lease_token=NULL WHERE id=1 AND ${active}`,
  ).run();
}

export async function finish(
  lease: SyncLeaseType,
  random: number,
  error: string | null,
): Promise<void> {
  const now = lease.now();
  const result = await guarded(
    lease,
    `UPDATE member_sync_state SET roster=NULL,started_at=NULL,lease_token=NULL,lease_until=0,
    next_run_at=?,last_finished_at=?,last_error=? WHERE id=1 AND ${active}`,
    [nextRunAt(now, random), now, error],
  ).run();
  if (!result.meta.changes) throw new SyncError('lease_lost');
}
