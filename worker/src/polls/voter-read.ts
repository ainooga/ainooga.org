import { sessionContext, voterLabel } from './session-context.js';
import { reject } from '../auth/http.js';
import type { Voter } from './access.js';
import { sessionStatement, requireSession } from './access.js';
import { ballotStatement, ballotResult } from './ballot-read.js';
import { config } from './store.js';
import type { PollRow } from './store.js';
import { resultStatements, resultsBody } from './results.js';

export async function readBallot(db: D1Database, p: PollRow, voter: Voter) {
  const data = await db.batch<Record<string, unknown>>([
    sessionStatement(db, voter, p.id),
    ballotStatement(db, p.id, voter.personId),
  ]);
  requireSession(data[0]!);
  return ballotResult(data[1]!);
}
export async function readDetails(db: D1Database, p: PollRow, voter: Voter) {
  const data = await db.batch<Record<string, unknown>>([
    sessionStatement(db, voter, p.id),
    ballotStatement(db, p.id, voter.personId),
    db.prepare('SELECT * FROM polls WHERE id=?').bind(p.id),
    db
      .prepare(
        'SELECT id,label,origin,position,description FROM poll_options WHERE poll_id=? ORDER BY position,id',
      )
      .bind(p.id),
  ]);
  requireSession(data[0]!);
  return {
    ...config(data[2]!.results[0] as unknown as PollRow),
    sessionContext: await sessionContext(voter, p.id),
    voter: voterLabel(data[0]!.results[0]!),
    options: data[3]!.results,
    ballot: ballotResult(data[1]!),
  };
}
export async function readResults(db: D1Database, p: PollRow, voter: Voter) {
  const hidden =
    p.results_visibility === 'never' ||
    (p.results_visibility === 'after_vote' && !(await readBallot(db, p, voter)));
  if (hidden) reject(403, 'hidden_results', 'Results are not available to this voter.');
  // Results policy is frozen and accepted ballots cannot be deleted by the API.
  // Recheck the session/eligibility in the same batch as the aggregate snapshot.
  const data = await db.batch<Record<string, unknown>>([
    sessionStatement(db, voter, p.id),
    ...resultStatements(db, p.id),
  ]);
  requireSession(data[0]!);
  return resultsBody(data.slice(1));
}
