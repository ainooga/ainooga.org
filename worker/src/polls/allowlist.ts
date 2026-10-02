import { z } from 'zod';
import { eligibilitySchema } from './schemas.js';
import { getPoll } from './store.js';
import { reject } from '../auth/http.js';

type Change = z.infer<typeof eligibilitySchema>;
function statements(db: D1Database, pollId: number, input: Change, now: string) {
  const sql: D1PreparedStatement[] = [];
  for (const item of input.identifiers) {
    const value = item.kind === 'email' ? item.value.toLowerCase() : item.value;
    const identity =
      'SELECT person_id FROM person_identifiers WHERE kind=? AND normalized_value=?';
    const writable = "EXISTS (SELECT 1 FROM polls WHERE id=? AND status!='archived')";
    if (input.action === 'add') {
      sql.push(
        db
          .prepare(
            `INSERT INTO people (created_at,updated_at) SELECT ?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
          )
          .bind(now, now, item.kind, value, pollId),
      );
      sql.push(
        db
          .prepare(
            `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
        SELECT last_insert_rowid(),?,?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
          )
          .bind(item.kind, value, value, item.kind, value, pollId),
      );
    }
    sql.push(
      db
        .prepare(
          `INSERT INTO poll_allowlist (poll_id,person_id,added_at,revoked_at)
      SELECT ?,person_id,?,? FROM person_identifiers WHERE kind=? AND normalized_value=? AND ${writable}
      ON CONFLICT (poll_id,person_id) DO UPDATE SET revoked_at=excluded.revoked_at`,
        )
        .bind(
          pollId,
          now,
          input.action === 'revoke' ? now : null,
          item.kind,
          value,
          pollId,
        ),
    );
  }
  return sql;
}
export async function changeAllowlist(
  db: D1Database,
  slug: string,
  input: Change,
  now: string,
) {
  const p = await getPoll(db, slug);
  if (p.status === 'archived') reject(409, 'archived', 'Archived polls cannot change.');
  // Revoking an unknown identifier must not invent a person, or silently miss a typo.
  if (input.action === 'revoke') {
    for (const item of input.identifiers) {
      const value = item.kind === 'email' ? item.value.toLowerCase() : item.value;
      if (
        !(await db
          .prepare(
            'SELECT id FROM person_identifiers WHERE kind=? AND normalized_value=?',
          )
          .bind(item.kind, value)
          .first())
      )
        reject(400, 'unknown_identifier', 'Cannot revoke an unknown identifier.');
    }
  }
  const results = await db.batch<Record<string, unknown>>([
    ...statements(db, p.id, input, now),
    db.prepare('SELECT status FROM polls WHERE id=?').bind(p.id),
  ]);
  if (results.at(-1)!.results[0]!.status === 'archived')
    reject(409, 'archived', 'Archived polls cannot change.');
  return { processed: input.identifiers.length };
}
export async function listAllowlist(db: D1Database, slug: string) {
  const p = await getPoll(db, slug);
  return (
    await db
      .prepare(
        `SELECT a.person_id AS personId,p.name,a.added_at AS addedAt,a.revoked_at AS revokedAt
    FROM poll_allowlist a JOIN people p ON p.id=a.person_id WHERE a.poll_id=? ORDER BY a.person_id`,
      )
      .bind(p.id)
      .all()
  ).results;
}
