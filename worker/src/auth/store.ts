import type { Identity, Poll, Session } from './types.js';
import { reject } from './http.js';

export async function findPoll(db: D1Database, slug: string): Promise<Poll> {
  const row = await db
    .prepare(
      "SELECT id,slug,identity_mode FROM polls WHERE slug = ? AND status = 'published'",
    )
    .bind(slug)
    .first<Poll>();
  return row ?? reject(404, 'not_found', 'Poll not found.');
}

export async function eligibleIdentity(
  db: D1Database,
  pollId: number,
  kind: string,
  value: string,
): Promise<Identity | null> {
  return db
    .prepare(
      `SELECT i.id,i.person_id,i.normalized_value FROM person_identifiers i
    JOIN poll_allowlist a ON a.person_id = i.person_id
    WHERE i.kind = ? AND i.normalized_value = ? AND a.poll_id = ? AND a.revoked_at IS NULL`,
    )
    .bind(kind, value, pollId)
    .first<Identity>();
}

export async function insertSession(
  db: D1Database,
  hash: string,
  identity: Identity,
  poll: Poll,
  assurance: 'honor' | 'verified',
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO voter_sessions
    (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
    SELECT ?,i.person_id,i.id,i.normalized_value,?,?,?,? FROM person_identifiers i
    JOIN poll_allowlist a ON a.person_id = i.person_id JOIN polls p ON p.id = a.poll_id
    WHERE i.id = ? AND i.person_id = ? AND i.normalized_value = ?
      AND a.poll_id = ? AND a.revoked_at IS NULL AND p.status = 'published'
      AND (? = 'verified' OR p.identity_mode = 'honor')`,
    )
    .bind(
      hash,
      assurance,
      assurance === 'honor' ? poll.id : null,
      now.toISOString(),
      new Date(now.getTime() + 86400000).toISOString(),
      identity.id,
      identity.person_id,
      identity.normalized_value,
      poll.id,
      assurance,
    )
    .run();
  return result.meta.changes === 1;
}

export async function readSession(
  db: D1Database,
  hash: string,
  poll: Poll,
  now: Date,
): Promise<Session | null> {
  return db
    .prepare(
      `SELECT s.person_id,s.assurance,s.expires_at FROM voter_sessions s
    JOIN person_identifiers i ON i.id = s.identifier_id AND i.person_id = s.person_id AND i.normalized_value = s.identifier_value
    JOIN poll_allowlist a ON a.person_id = s.person_id
    JOIN polls p ON p.id = a.poll_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.poll_id = ? AND a.revoked_at IS NULL
    AND p.status = 'published' AND (s.assurance = 'verified' OR (s.poll_id = p.id AND p.identity_mode = 'honor'))`,
    )
    .bind(hash, now.toISOString(), poll.id)
    .first<Session>();
}

export async function cleanupAuth(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  await db.batch([
    db
      .prepare(
        'DELETE FROM voter_sessions WHERE token_hash IN (SELECT token_hash FROM voter_sessions WHERE expires_at < ? LIMIT 1000)',
      )
      .bind(cutoff),
    db
      .prepare(
        'DELETE FROM auth_challenges WHERE id IN (SELECT id FROM auth_challenges WHERE expires_at < ? LIMIT 1000)',
      )
      .bind(cutoff),
  ]);
}
