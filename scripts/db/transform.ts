import { createHash } from 'node:crypto';
import { normalizeEmail } from '../../worker/src/db/identifiers.js';
import { timestamp } from './legacy.js';
import type { ExpectedRow, LegacyData, Row } from './types.js';

function subscriberRows(row: Row, now: string): ExpectedRow[] {
  const id = Number(row.id);
  const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name : null;
  const pendingToken =
    row.confirmed === 0 && typeof row.confirmation_token === 'string'
      ? createHash('sha256').update(row.confirmation_token).digest('hex')
      : null;
  return [
    {
      table: 'people',
      row: {
        id,
        name,
        company: null,
        professional_role: null,
        created_at: now,
        updated_at: now,
      },
    },
    {
      table: 'person_identifiers',
      row: {
        id,
        person_id: id,
        kind: 'email',
        value: String(row.email),
        normalized_value: normalizeEmail(String(row.email)),
        display_label: null,
        verified_at: null,
        created_at: now,
      },
    },
    {
      table: 'person_sources',
      row: {
        id,
        person_id: id,
        source: 'legacy_subscribers',
        source_key: String(id),
        first_imported_at: now,
        last_imported_at: now,
      },
    },
    subscriptionRow(row, pendingToken),
  ];
}

export function transform(data: LegacyData, now: string): ExpectedRow[] {
  return [
    ...data.subscribers.flatMap((row) => subscriberRows(row, now)),
    ...data.contacts.map(
      (row): ExpectedRow => ({
        table: 'contact_requests',
        row: {
          id: Number(row.id),
          person_id: null,
          submitted_name: String(row.name),
          submitted_phone: String(row.phone),
          preferred_date: row.preferred_date ?? null,
          preferred_time: row.preferred_time ?? null,
          source: row.source ?? null,
          created_at: timestamp(row.created_at, 'created_at'),
        },
      }),
    ),
  ];
}

function subscriptionRow(row: Row, pendingToken: string | null): ExpectedRow {
  const id = Number(row.id);
  return {
    table: 'subscriptions',
    row: {
      id,
      person_id: id,
      email_identifier_id: id,
      kind: 'newsletter',
      status: row.confirmed === 1 ? 'confirmed' : 'pending',
      confirmation_token_hash: pendingToken,
      confirmation_expires_at: null,
      confirmed_at: timestamp(row.confirmed_at, 'confirmed_at'),
      unsubscribed_at: null,
      source: row.source ?? null,
      created_at: timestamp(row.created_at, 'created_at'),
    },
  };
}
