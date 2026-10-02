import { reject } from '../auth/http.js';
import { requireSession } from './access.js';
import { ballotResult, checkWindow } from './ballot-read.js';
import type { Submission } from './ballot-sql.js';
import { DATABASE_NOW } from './clock.js';
import { writeInAllowed, WRITE_INS_PER_PERSON, OPTIONS_PER_POLL } from './limits.js';
import type { PollRow } from './store.js';

export function diagnostics(db: D1Database, s: Submission) {
  return db
    .prepare(
      `SELECT ${DATABASE_NOW} AS now,${writeInAllowed} AS writeInAllowed
    FROM polls p CROSS JOIN (SELECT ? AS person_id) s WHERE p.id=?`,
    )
    .bind(s.normalized, s.normalized, s.personId, s.pollId);
}
export function submissionOutcome(
  p: PollRow,
  s: Submission,
  results: D1Result<Record<string, unknown>>[],
) {
  const receipt = results[6]!.results[0];
  // Winning this private nonce proves authorization at the atomic claim. A later
  // expiry must not report failure for a ballot that the transaction accepted.
  if (receipt?.attempt_nonce === s.nonce) return ballotResult(results[7]!);
  requireSession(results[5]!);
  if (receipt?.request_id === s.input.requestId && receipt.payload_hash === s.payloadHash)
    return ballotResult(results[7]!);
  const state = results[8]!.results[0]!;
  checkWindow(p, s.input, String(state.now));
  if (state.writeInAllowed === 0)
    reject(
      409,
      'write_in_limit',
      `Each person can create at most ${WRITE_INS_PER_PERSON} new write-in per poll, and polls can contain at most ${OPTIONS_PER_POLL} options. Choose an existing option.`,
    );
  return reject(
    409,
    'ballot_conflict',
    'Ballot was not accepted. Check selections and reload your current ballot before retrying.',
  );
}
