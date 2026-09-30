import type { AuthDependencies, Identity, Poll } from './types.js';

export async function createEmailChallenge(
  deps: AuthDependencies,
  poll: Poll,
  identity: Identity,
  id: string,
  browserHash: string,
  proofHash: string,
): Promise<boolean> {
  const now = deps.now();
  const result = await deps.db
    .prepare(
      `INSERT INTO auth_challenges
    (id,kind,poll_id,identifier_id,identifier_value,browser_hash,proof_hash,created_at,expires_at)
    SELECT ?,'email',?,?,?,?,?,?,? WHERE NOT EXISTS
    (SELECT 1 FROM auth_challenges WHERE identifier_id = ? AND created_at > ?)
    AND (SELECT COUNT(*) FROM auth_challenges WHERE identifier_id = ? AND created_at > ?) < 5`,
    )
    .bind(
      id,
      poll.id,
      identity.id,
      identity.normalized_value,
      browserHash,
      proofHash,
      now.toISOString(),
      new Date(now.getTime() + 600000).toISOString(),
      identity.id,
      new Date(now.getTime() - 60000).toISOString(),
      identity.id,
      new Date(now.getTime() - 3600000).toISOString(),
    )
    .run();
  return result.meta.changes === 1;
}

export async function consumeEmail(
  deps: AuthDependencies,
  poll: Poll,
  id: string,
  browserHash: string,
  proofHash: string,
  sessionHash: string,
): Promise<boolean> {
  const now = deps.now().toISOString();
  const expires = new Date(deps.now().getTime() + 86400000).toISOString();
  const results = await deps.db.batch([
    deps.db
      .prepare(
        `UPDATE auth_challenges SET attempts = attempts + 1,
      consumed_by = CASE WHEN proof_hash = ? THEN ? ELSE NULL END
      WHERE id = ? AND browser_hash = ? AND poll_id = ? AND kind = 'email'
      AND consumed_by IS NULL AND expires_at > ? AND attempts < 5
      AND EXISTS (SELECT 1 FROM person_identifiers i JOIN poll_allowlist a ON a.person_id = i.person_id
        JOIN polls p ON p.id = a.poll_id WHERE i.id = auth_challenges.identifier_id
        AND i.normalized_value = auth_challenges.identifier_value
        AND a.poll_id = auth_challenges.poll_id AND a.revoked_at IS NULL AND p.status = 'published')`,
      )
      .bind(proofHash, sessionHash, id, browserHash, poll.id, now),
    deps.db
      .prepare(
        `INSERT INTO voter_sessions
      (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
      SELECT ?,i.person_id,i.id,i.normalized_value,'verified',NULL,?,?
      FROM auth_challenges c JOIN person_identifiers i ON i.id = c.identifier_id
      WHERE c.id = ? AND c.consumed_by = ?`,
      )
      .bind(sessionHash, now, expires, id, sessionHash),
    deps.db
      .prepare(
        `UPDATE person_identifiers SET verified_at = ? WHERE id =
      (SELECT identifier_id FROM auth_challenges WHERE id = ? AND consumed_by = ?)`,
      )
      .bind(now, id, sessionHash),
  ]);
  return results[1]!.meta.changes === 1;
}
