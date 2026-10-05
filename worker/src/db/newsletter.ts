import { hashToken, normalizeEmail } from './identifiers.js';

export async function insertSubscriber(
  db: D1Database,
  email: string,
  name: string | null,
  token: string,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const hash = await hashToken(token);
  // A batch executes as one transaction. Only the request that claims the
  // confirmation token may send mail; concurrent duplicates cannot create orphan people.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO people (name) SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM person_identifiers WHERE kind = 'email' AND normalized_value = ?
    )`,
      )
      .bind(name?.trim() || null, normalized),
    db
      .prepare(
        `INSERT INTO person_identifiers (person_id, kind, value, normalized_value)
      SELECT last_insert_rowid(), 'email', ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM person_identifiers WHERE kind = 'email' AND normalized_value = ?
      )`,
      )
      .bind(email.trim(), normalized, normalized),
    db
      .prepare(
        `INSERT INTO subscriptions
      (person_id, email_identifier_id, kind, status, confirmation_token_hash, source)
      SELECT person_id, id, 'newsletter', 'pending', ?, 'website'
      FROM person_identifiers WHERE kind = 'email' AND normalized_value = ?
      ON CONFLICT (person_id, kind) DO UPDATE SET confirmation_token_hash = excluded.confirmation_token_hash,
        confirmation_expires_at = NULL
      WHERE subscriptions.status = 'pending' AND subscriptions.source = 'website'
        AND subscriptions.email_identifier_id = excluded.email_identifier_id
        AND subscriptions.confirmation_token_hash IS NULL`,
      )
      .bind(hash, normalized),
  ]);
  return results[2]?.meta.changes === 1;
}

export async function confirmSubscription(
  db: D1Database,
  token: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE subscriptions
    SET status = 'confirmed', confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        confirmation_token_hash = NULL, confirmation_expires_at = NULL
    WHERE kind = 'newsletter' AND status = 'pending' AND confirmation_token_hash = ?
      AND (confirmation_expires_at IS NULL OR
           confirmation_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
    .bind(await hashToken(token))
    .run();
  return result.meta.changes;
}

export async function invalidateConfirmation(
  db: D1Database,
  token: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE subscriptions SET confirmation_token_hash = NULL, confirmation_expires_at = NULL
    WHERE kind = 'newsletter' AND status = 'pending' AND source = 'website'
      AND confirmation_token_hash = ?`,
    )
    .bind(await hashToken(token))
    .run();
}
