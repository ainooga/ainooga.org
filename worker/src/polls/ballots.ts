import { requireContext } from './session-context.js';
import type { AuthDependencies } from '../auth/types.js';
import { hashToken } from '../auth/crypto.js';
import type { Voter } from './access.js';
import { sessionStatement } from './access.js';
import { ballotStatement } from './ballot-read.js';
import { claim, mutateBallot } from './ballot-sql.js';
import { diagnostics, submissionOutcome } from './ballot-outcome.js';
import type { BallotInput } from './schemas.js';
import { normalizeLabel } from './schemas.js';
import type { PollRow } from './store.js';

export async function submitBallot(
  deps: AuthDependencies,
  p: PollRow,
  voter: Voter,
  input: BallotInput,
) {
  await requireContext(input.sessionContext, voter, p.id);
  input = { ...input, optionIds: [...new Set(input.optionIds)].sort((a, b) => a - b) };
  const normalized = input.writeIn === null ? null : normalizeLabel(input.writeIn);
  const payloadHash = await hashToken(
    JSON.stringify([input.expectedRevision, input.optionIds, normalized]),
  );
  const s = {
    pollId: p.id,
    personId: voter.personId,
    sessionHash: voter.hash,
    nonce: deps.random(),
    payloadHash,
    input,
    normalized,
  };
  // D1 serializes the conditional claim and nonce-guarded writes. Any error rolls
  // back the entire batch. Only a winning claim may create an option or ballot.
  const results = await deps.db.batch<Record<string, unknown>>([
    claim(deps.db, s),
    ...mutateBallot(deps.db, s),
    sessionStatement(deps.db, voter, p.id),
    deps.db
      .prepare(
        'SELECT request_id,payload_hash,attempt_nonce FROM poll_ballots WHERE poll_id=? AND person_id=?',
      )
      .bind(p.id, voter.personId),
    ballotStatement(deps.db, p.id, voter.personId),
    diagnostics(deps.db, s),
  ]);
  return submissionOutcome(p, s, results);
}
