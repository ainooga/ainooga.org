import type { MemberInput, Row } from '../members/schemas.js';
import { peopleWrites } from '../members/people.js';
import { importSql, permitted, snapshot } from '../members/sql.js';
import { importReport } from '../members/report.js';
import { fence, SyncError, type SyncLeaseType } from './state.js';

export async function applyMember(
  lease: SyncLeaseType,
  input: MemberInput,
): Promise<void> {
  const guard = fence(lease);
  guard.sql += ' AND EXISTS (SELECT 1 FROM member_sync_state WHERE id=1 AND cursor=?)';
  guard.values.push(lease.cursor);
  const sql = importSql(lease.db, input, guard);
  const reads = snapshot(sql, input);
  const results = await lease.db.batch<Row>([
    ...reads,
    ...peopleWrites(sql, input),
    sql.write(
      `UPDATE people SET name=?,professional_role=?,updated_at=?
      WHERE id=${sql.person} AND (name IS NOT ? OR professional_role IS NOT ?) AND ${permitted}`,
      [
        input.name,
        input.professionalRole,
        new Date(lease.now()).toISOString(),
        sql.email,
        input.name,
        input.professionalRole,
      ],
    ),
    sql.write(`UPDATE member_sync_state SET cursor=cursor+1 WHERE id=1 AND ${permitted}`),
  ]);
  if (
    importReport(
      results.slice(0, reads.length).map((r) => r.results),
      input,
    ).conflicts.length
  )
    throw new SyncError('identity_conflict');
  if (!results.at(-1)!.meta.changes) throw new SyncError('lease_lost');
  lease.cursor++;
}
