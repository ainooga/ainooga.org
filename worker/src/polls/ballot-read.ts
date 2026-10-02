import { reject } from '../auth/http.js';
import type { BallotInput } from './schemas.js';
import type { PollRow } from './store.js';

export function ballotStatement(db: D1Database, pollId: number, personId: number) {
  return db
    .prepare(
      `SELECT b.revision,b.submitted_at AS submittedAt,b.updated_at AS updatedAt,
    (SELECT json_group_array(option_id) FROM (SELECT option_id FROM poll_ballot_choices WHERE ballot_id=b.id ORDER BY option_id)) AS selections
    FROM poll_ballots b WHERE b.poll_id=? AND b.person_id=?`,
    )
    .bind(pollId, personId);
}
export function ballotResult(result: D1Result<Record<string, unknown>>) {
  const row = result.results[0];
  return row
    ? {
        revision: Number(row.revision),
        submittedAt: String(row.submittedAt),
        updatedAt: String(row.updatedAt),
        optionIds: JSON.parse(String(row.selections)) as number[],
      }
    : null;
}
export function checkWindow(p: PollRow, input: BallotInput, now: string): void {
  if (now < p.starts_at || now >= p.ends_at) reject(409, 'closed', 'Voting is not open.');
  if (
    input.expectedRevision > 0 &&
    (!p.allow_edits || now >= (p.edit_deadline ?? p.ends_at))
  )
    reject(409, 'edits_closed', 'Ballot edits are closed.');
}
