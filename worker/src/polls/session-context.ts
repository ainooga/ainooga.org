import { hashToken, sameHash } from '../auth/crypto.js';
import { reject } from '../auth/http.js';
import type { Voter } from './access.js';

export function sessionContext(voter: Voter, pollId: number): Promise<string> {
  return hashToken(
    JSON.stringify(['poll-voter-context-v1', pollId, voter.personId, voter.hash]),
  );
}

export async function requireContext(
  context: string,
  voter: Voter,
  pollId: number,
): Promise<void> {
  if (!sameHash(context, await sessionContext(voter, pollId)))
    reject(
      409,
      'session_changed',
      'Your voter identity changed after starting this vote.',
    );
}

export function voterLabel(row: Record<string, unknown>) {
  return {
    kind: String(row.kind),
    value:
      row.kind === 'email'
        ? String(row.normalized_value)
        : String(row.display_label ?? '').trim() || String(row.normalized_value),
  };
}
