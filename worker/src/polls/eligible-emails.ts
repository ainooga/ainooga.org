export function replaceEmailAllowlist(
  db: D1Database,
  slug: string,
  emails: string[] | undefined,
  now: string,
  status: 'draft' | 'published',
): D1PreparedStatement[] {
  if (emails === undefined) return [];
  const addresses = [...new Set(emails)];
  const identity =
    "SELECT person_id FROM person_identifiers WHERE kind='email' AND normalized_value=?";
  const writable = 'EXISTS (SELECT 1 FROM polls WHERE slug=? AND status=?)';
  const statements = addresses.flatMap((email) => [
    db
      .prepare(
        `INSERT INTO people(created_at,updated_at)
      SELECT ?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
      )
      .bind(now, now, email, slug, status),
    db
      .prepare(
        `INSERT INTO person_identifiers(person_id,kind,value,normalized_value)
      SELECT last_insert_rowid(),'email',?,? WHERE NOT EXISTS (${identity}) AND ${writable}`,
      )
      .bind(email, email, email, slug, status),
  ]);
  statements.push(
    db
      .prepare(
        `UPDATE polls SET allowed_person_ids=(
    SELECT json_group_array(person_id) FROM (
      SELECT DISTINCT person_id FROM person_identifiers
      WHERE kind='email' AND normalized_value IN (SELECT value FROM json_each(?)) ORDER BY person_id))
    WHERE slug=? AND status=?`,
      )
      .bind(JSON.stringify(addresses), slug, status),
  );
  return statements;
}

export async function explicitEmails(db: D1Database, pollId: number): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT i.normalized_value AS email
    FROM polls p,json_each(p.allowed_person_ids) allowed
    JOIN person_identifiers i ON i.person_id=allowed.value AND i.kind='email'
    WHERE p.id=? ORDER BY email`,
    )
    .bind(pollId)
    .all<{ email: string }>();
  return result.results.map((row) => row.email);
}
