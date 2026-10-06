import type { MemberInput, ImportEvent } from './schemas.js';

type Value = string | number | null;
export function importSql(db: D1Database, input: MemberInput) {
  const email = input.email.toLowerCase();
  const identity =
    "SELECT person_id FROM person_identifiers WHERE kind='email' AND normalized_value=?";
  const source = 'SELECT person_id FROM person_sources WHERE source=? AND source_key=?';
  // Re-evaluated within the same batch as every write. A conflicting source
  // must never create even a partial person, event, or subscription.
  const allowed = `NOT EXISTS (${source} AND person_id != COALESCE((${identity}),-1))
    AND NOT EXISTS (SELECT 1 FROM person_sources WHERE source=? AND source_key!=? AND person_id=(${identity}))`;
  const guard = [
    input.source,
    input.sourceKey,
    email,
    input.source,
    input.sourceKey,
    email,
  ];
  const prepare = (sql: string, params: Value[] = []) => db.prepare(sql).bind(...params);
  const write = (sql: string, params: Value[] = []) =>
    prepare(`WITH permitted AS (SELECT 1 WHERE ${allowed}) ${sql}`, [
      ...guard,
      ...params,
    ]);
  return { email, identity, prepare, write, person: `(${identity})` };
}
export type ImportSql = ReturnType<typeof importSql>;
export const permitted = 'EXISTS (SELECT 1 FROM permitted)';
export const eventId =
  '(SELECT event_id FROM event_links WHERE platform=? AND external_id=?)';
export const eventValues = (event: ImportEvent) => [event.platform, event.externalId];

export function snapshot(sql: ImportSql, input: MemberInput): D1PreparedStatement[] {
  const { prepare, person, email } = sql;
  return [
    prepare(`SELECT * FROM people WHERE id=${person}`, [email]),
    prepare(
      `SELECT * FROM person_sources WHERE (source=? AND source_key=?) OR (source=? AND person_id=${person})`,
      [input.source, input.sourceKey, input.source, email],
    ),
    prepare(`SELECT * FROM person_identifiers WHERE person_id=${person}`, [email]),
    prepare(
      `SELECT o.id,op.person_id FROM organizations o LEFT JOIN organization_people op
      ON op.organization_id=o.id AND op.person_id=${person} AND op.relationship='employee'
      WHERE lower(trim(o.name))=lower(trim(?))`,
      [email, input.company],
    ),
    prepare(
      `SELECT * FROM subscriptions WHERE kind='event_invites' AND person_id=${person}`,
      [email],
    ),
    prepare(`SELECT tag FROM person_tags WHERE person_id=${person}`, [email]),
    ...input.participations.flatMap(({ event }) => [
      prepare(
        `SELECT e.*,l.url FROM events e JOIN event_links l ON l.event_id=e.id WHERE l.platform=? AND l.external_id=?`,
        eventValues(event),
      ),
      prepare(
        `SELECT * FROM event_participation WHERE event_id=${eventId} AND person_id=${person}`,
        [...eventValues(event), email],
      ),
    ]),
  ];
}
