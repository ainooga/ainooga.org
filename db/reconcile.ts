import { createHash } from 'node:crypto';
import { preflight, readLegacy, timestamp } from './legacy.js';
import { literal, insertSql, type Row, type SqlStore } from './types.js';
import { normalizeEmail } from '../worker/src/db/identifiers.js';

function contact(row: Row): Row {
  return {
    id: row.id!,
    person_id: null,
    submitted_name: row.name!,
    submitted_phone: row.phone!,
    preferred_date: row.preferred_date ?? null,
    preferred_time: row.preferred_time ?? null,
    source: row.source ?? null,
    created_at: timestamp(row.created_at, 'created_at'),
  };
}
function newsletter(row: Row): Row {
  const token =
    row.confirmed === 0 && typeof row.confirmation_token === 'string'
      ? createHash('sha256').update(row.confirmation_token).digest('hex')
      : null;
  return {
    kind: 'newsletter',
    status: row.confirmed === 1 ? 'confirmed' : 'pending',
    confirmation_token_hash: token,
    confirmation_expires_at: null,
    confirmed_at: timestamp(row.confirmed_at, 'confirmed_at'),
    unsubscribed_at: null,
    source: row.source ?? null,
    created_at: timestamp(row.created_at, 'created_at'),
  };
}
interface Existing {
  identities: Row[];
  sources: Row[];
  subscriptions: Row[];
  contacts: Row[];
}
function validateSubscriber(row: Row, state: Existing): void {
  const email = normalizeEmail(String(row.email));
  const identity = state.identities.find((i) => i.normalized_value === email);
  const source = state.sources.find((s) => s.source_key === String(row.id));
  if (source && source.person_id !== identity?.person_id)
    throw new Error(`Legacy subscriber ${row.id}: conflicting identity/provenance`);
  const subscription = state.subscriptions.find(
    (s) => s.person_id === identity?.person_id && s.kind === 'newsletter',
  );
  const hash = newsletter(row).confirmation_token_hash;
  if (
    !subscription &&
    hash !== null &&
    state.subscriptions.some((s) => s.confirmation_token_hash === hash)
  )
    throw new Error(`Legacy subscriber ${row.id}: confirmation token is already in use`);
}
function subscriberStatements(row: Row): string[] {
  const email = literal(normalizeEmail(String(row.email)));
  const identity = `SELECT id,person_id FROM person_identifiers WHERE kind='email' AND normalized_value=${email}`;
  const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name : null;
  const subscription = newsletter(row);
  return [
    `INSERT INTO people(name) SELECT ${literal(name)} WHERE NOT EXISTS (${identity})`,
    `INSERT INTO person_identifiers(person_id,kind,value,normalized_value)
      SELECT last_insert_rowid(),'email',${literal(String(row.email))},${email} WHERE NOT EXISTS (${identity})`,
    `UPDATE people SET name=${literal(name)} WHERE id=(SELECT person_id FROM (${identity}))
      AND (name IS NULL OR trim(name)='') AND ${literal(name)} IS NOT NULL`,
    `INSERT INTO person_sources(person_id,source,source_key)
      SELECT person_id,'legacy_subscribers',${literal(String(row.id))} FROM (${identity})
      WHERE true ON CONFLICT(source,source_key) DO NOTHING`,
    `INSERT INTO subscriptions(person_id,email_identifier_id,${Object.keys(subscription).join(',')})
      SELECT person_id,id,${Object.values(subscription).map(literal).join(',')} FROM (${identity})
      WHERE true ON CONFLICT(person_id,kind) DO NOTHING`,
  ];
}
function contactStatements(rows: Row[], state: Existing): string[] {
  return rows.flatMap((row) => {
    const wanted = contact(row);
    const existing = state.contacts.find((c) => c.id === row.id);
    if (!existing) return [insertSql({ table: 'contact_requests', row: wanted })];
    if (
      Object.entries(wanted).some(
        ([key, value]) => key !== 'person_id' && existing[key] !== value,
      )
    )
      throw new Error(`Legacy inquiry ${row.id}: conflicting current inquiry`);
    return [];
  });
}

export async function reconcileLegacy(db: SqlStore): Promise<void> {
  const data = await readLegacy(db);
  // This obsolete field is deliberately discarded, not interpreted as consent.
  for (const row of data.subscribers) delete row.preferences;
  preflight(data);
  const [identities, sources, subscriptions, contacts] = await Promise.all([
    db.query("SELECT * FROM person_identifiers WHERE kind='email'"),
    db.query("SELECT * FROM person_sources WHERE source='legacy_subscribers'"),
    db.query('SELECT * FROM subscriptions'),
    db.query('SELECT * FROM contact_requests'),
  ]);
  const state = { identities, sources, subscriptions, contacts };
  data.subscribers.forEach((row) => validateSubscriber(row, state));
  const inquiries = contactStatements(data.contacts, state);
  // Validate every mapping before writes. Each subscriber is atomic and rerunnable.
  for (const row of data.subscribers) await db.execute(subscriberStatements(row));
  for (const statement of inquiries) await db.execute([statement]);
}
