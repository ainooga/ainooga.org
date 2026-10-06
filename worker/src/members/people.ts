import { organizationWrites } from './organizations.js';
import { contacts, type MemberInput } from './schemas.js';
import { permitted, type ImportSql } from './sql.js';

export function peopleWrites(sql: ImportSql, input: MemberInput) {
  const { write, person, email } = sql;
  return [
    write(
      `INSERT INTO people (name,professional_role) SELECT ?,?
      WHERE ${permitted} AND ${person} IS NULL`,
      [input.name, input.professionalRole, email],
    ),
    write(
      `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
      SELECT last_insert_rowid(),'email',?,? WHERE ${permitted} AND ${person} IS NULL`,
      [input.email, email, email],
    ),
    ...profileWrites(sql, input),
    write(
      `INSERT INTO person_sources (person_id,source,source_key)
      SELECT ${person},?,? WHERE ${permitted}
      ON CONFLICT(source,source_key) DO UPDATE SET last_imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [email, input.source, input.sourceKey],
    ),
    ...organizationWrites(sql, input),
    ...contacts(input).map((c) =>
      write(
        `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
      SELECT ${person},?,?,? WHERE ${permitted} ON CONFLICT(person_id,kind,normalized_value) DO NOTHING`,
        [email, c.kind, c.value, c.normalized],
      ),
    ),
    ...[...new Set(['member', ...input.tags])].map((tag) =>
      write(
        `INSERT INTO person_tags (person_id,tag)
      SELECT ${person},? WHERE ${permitted} ON CONFLICT(person_id,tag) DO NOTHING`,
        [email, tag],
      ),
    ),
    subscriptionWrite(sql, input),
  ];
}

function profileWrites({ write, person, email }: ImportSql, input: MemberInput) {
  return [
    ['name', input.name],
    ['professional_role', input.professionalRole],
  ]
    .filter(([, value]) => value !== null)
    .map(([field, value]) =>
      write(
        `UPDATE people SET ${field}=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=${person} AND (${field} IS NULL OR trim(${field})='') AND ${permitted}`,
        [value!, email],
      ),
    );
}

function subscriptionWrite({ write, email }: ImportSql, input: MemberInput) {
  return write(
    `INSERT INTO subscriptions (person_id,email_identifier_id,kind,status,unsubscribed_at,source)
    SELECT person_id,id,'event_invites',?,?,? FROM person_identifiers
    WHERE kind='email' AND normalized_value=? AND ${permitted}
    ON CONFLICT(person_id,kind) DO UPDATE SET status='unsubscribed',
      unsubscribed_at=COALESCE(subscriptions.unsubscribed_at,excluded.unsubscribed_at),
      confirmation_token_hash=NULL,confirmation_expires_at=NULL,source=excluded.source
    WHERE excluded.status='unsubscribed' AND (subscriptions.status!='unsubscribed'
      OR (subscriptions.unsubscribed_at IS NULL AND excluded.unsubscribed_at IS NOT NULL))`,
    [input.eventInvites.status, input.eventInvites.unsubscribedAt, input.source, email],
  );
}
