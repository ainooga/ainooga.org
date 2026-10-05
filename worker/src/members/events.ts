import type { MemberInput, ImportEvent } from './schemas.js';
import { eventId, eventValues, permitted, type ImportSql } from './sql.js';

export function eventWrites(sql: ImportSql, input: MemberInput) {
  return input.participations.flatMap(({ event, registrationStatus }) => [
    sql.write(
      `INSERT INTO events (name,starts_at,ends_at,timezone,location,capacity)
      SELECT ?,?,?,?,?,? WHERE ${permitted} AND ${eventId} IS NULL`,
      [
        event.name,
        event.startsAt,
        event.endsAt,
        event.timezone,
        event.location,
        event.capacity,
        ...eventValues(event),
      ],
    ),
    sql.write(
      `INSERT INTO event_links (event_id,platform,external_id,url)
      SELECT last_insert_rowid(),?,?,? WHERE ${permitted} AND ${eventId} IS NULL`,
      [...eventValues(event), event.url, ...eventValues(event)],
    ),
    ...fillEvent(sql, event),
    sql.write(
      `INSERT INTO event_participation (event_id,person_id,registration_status,source)
      SELECT ${eventId},${sql.person},?,? WHERE ${permitted}
      ON CONFLICT(event_id,person_id) DO NOTHING`,
      [...eventValues(event), sql.email, registrationStatus, input.source],
    ),
  ]);
}

function fillEvent(sql: ImportSql, event: ImportEvent) {
  const fields: [string, string | number | null][] = [
    ['ends_at', event.endsAt],
    ['timezone', event.timezone],
    ['location', event.location],
    ['capacity', event.capacity],
  ];
  return fields
    .filter(([, value]) => value !== null)
    .map(([field, value]) =>
      sql.write(
        `UPDATE events SET ${field}=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=${eventId} AND (${field} IS NULL OR trim(${field})='') AND ${permitted}
      ${field === 'ends_at' ? 'AND ? > starts_at' : ''}`,
        [value, ...eventValues(event), ...(field === 'ends_at' ? [value] : [])],
      ),
    );
}
