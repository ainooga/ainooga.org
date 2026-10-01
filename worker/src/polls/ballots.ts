import type { AuthDependencies } from '../auth/types.js';
import { hashToken } from '../auth/crypto.js';
import { reject } from '../auth/http.js';
import type { Voter } from './access.js';
import { requireSession, sessionStatement } from './access.js';
import { ballotResult, ballotStatement, checkWindow } from './ballot-read.js';
import { claim, mutateBallot } from './ballot-sql.js';
import type { BallotInput } from './schemas.js';
import { normalizeLabel } from './schemas.js';
import type { PollRow } from './store.js';

export async function submitBallot(
  deps: AuthDependencies,
  p: PollRow,
  voter: Voter,
  input: BallotInput,
) {
  const normalized = input.writeIn === null ? null : normalizeLabel(input.writeIn);
  const payloadHash = await hashToken(
    JSON.stringify([
      input.expectedRevision,
      [...new Set(input.optionIds)].sort((a, b) => a - b),
      normalized,
    ]),
  );
  const now = deps.now().toISOString();
  const s = {
    pollId: p.id,
    personId: voter.personId,
    sessionHash: voter.hash,
    now,
    nonce: deps.random(),
    payloadHash,
    input,
    normalized,
  };
  // Every mutation is conditional on winning this attempt's receipt claim. D1 batch
  // serializes the claim and all dependent writes and rolls everything back on error.
  const results = await deps.db.batch<Record<string, unknown>>([
    claim(deps.db, s),
    ...mutateBallot(deps.db, s),
    sessionStatement(deps.db, voter, p.id, now),
    deps.db
      .prepare(
        'SELECT request_id,payload_hash FROM poll_submission_receipts WHERE poll_id=? AND person_id=?',
      )
      .bind(p.id, voter.personId),
    ballotStatement(deps.db, p.id, voter.personId),
  ]);
  requireSession(results[5]!);
  const receipt = results[6]!.results[0];
  if (receipt?.request_id === input.requestId && receipt.payload_hash === payloadHash)
    return ballotResult(results[7]!);
  checkWindow(p, input, now);
  return reject(
    409,
    'ballot_conflict',
    'Ballot was not accepted. Check selections and reload your current ballot before retrying.',
  );
}
