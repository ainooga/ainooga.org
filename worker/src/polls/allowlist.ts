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
            `INSERT INTO people(created_at,updated_at)
        SELECT ?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
          )
          .bind(now, now, item.kind, value, pollId),
      );
      sql.push(
        db
          .prepare(
            `INSERT INTO person_identifiers(person_id,kind,value,normalized_value)
        SELECT last_insert_rowid(),?,?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
          )
          .bind(item.kind, value, value, item.kind, value, pollId),
      );
    }
    const members =
      input.action === 'add'
        ? `SELECT value AS id FROM json_each(allowed_person_ids) UNION ${identity}`
        : `SELECT value AS id FROM json_each(allowed_person_ids) WHERE value NOT IN (${identity})`;
    // Read and replace JSON in the UPDATE, never from a stale JS snapshot.
    sql.push(
      db
        .prepare(
          `UPDATE polls SET allowed_person_ids=(SELECT json_group_array(id) FROM (SELECT id FROM (${members}) ORDER BY id))
      WHERE id=? AND status!='archived'`,
        )
        .bind(item.kind, value, pollId),
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
  if (input.action === 'remove') {
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
        reject(400, 'unknown_identifier', 'Cannot remove an unknown identifier.');
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
        `SELECT person.id AS personId,person.name FROM polls p,
    json_each(p.allowed_person_ids) j JOIN people person ON person.id=j.value WHERE p.id=? ORDER BY person.id`,
      )
      .bind(p.id)
      .all()
  ).results;
}
