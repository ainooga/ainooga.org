import type { AuthDependencies, Identity, Poll } from './types.js';

export interface DiscordChallenge {
  id: string;
  browserHash: string;
  poll: Poll;
}

function claimSession(
  db: D1Database,
  challenge: DiscordChallenge,
  identity: Identity,
  hash: string,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE auth_challenges
    SET consumed_by = ?, identifier_id = ?, identifier_value = ?
    WHERE id = ? AND browser_hash = ? AND poll_id = ? AND kind = 'discord'
      AND consumed_by = 'discord_exchange' AND expires_at > ?
      AND EXISTS (SELECT 1 FROM person_identifiers i
        JOIN poll_allowlist a ON a.person_id = i.person_id JOIN polls p ON p.id = a.poll_id
        WHERE i.id = ? AND i.person_id = ? AND i.kind = 'discord' AND i.normalized_value = ?
          AND a.poll_id = auth_challenges.poll_id AND a.revoked_at IS NULL AND p.status = 'published')`,
    )
    .bind(
      hash,
      identity.id,
      identity.normalized_value,
      challenge.id,
      challenge.browserHash,
      challenge.poll.id,
      now,
      identity.id,
      identity.person_id,
      identity.normalized_value,
    );
}

export async function finishDiscord(
  deps: AuthDependencies,
  challenge: DiscordChallenge,
  identity: Identity,
  hash: string,
): Promise<boolean> {
  const now = deps.now();
  const results = await deps.db.batch([
    claimSession(deps.db, challenge, identity, hash, now.toISOString()),
    deps.db
      .prepare(
        `INSERT INTO voter_sessions
      (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
      SELECT ?,i.person_id,i.id,i.normalized_value,'verified',NULL,?,?
      FROM auth_challenges c JOIN person_identifiers i ON i.id = c.identifier_id
      WHERE c.id = ? AND c.consumed_by = ?`,
      )
      .bind(
        hash,
        now.toISOString(),
        new Date(now.getTime() + 86400000).toISOString(),
        challenge.id,
        hash,
      ),
    deps.db
      .prepare(
        `UPDATE person_identifiers SET verified_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM voter_sessions WHERE token_hash = ?
        AND identifier_id = person_identifiers.id AND person_id = person_identifiers.person_id
        AND identifier_value = person_identifiers.normalized_value)`,
      )
      .bind(now.toISOString(), identity.id, hash),
  ]);
  return results[1]!.meta.changes === 1;
}
