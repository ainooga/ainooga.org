import { createHash } from 'node:crypto';
import { normalizeEmail, validEmail } from '../../worker/src/db/identifiers.js';
import type { LegacyData, Row, SqlStore } from './types.js';

const legacyColumns = {
  subscribers: [
    'id',
    'email',
    'name',
    'source',
    'created_at',
    'confirmed',
    'confirmation_token',
    'confirmed_at',
  ],
  contacts: [
    'id',
    'name',
    'phone',
    'preferred_date',
    'preferred_time',
    'source',
    'created_at',
  ],
};

export async function readLegacy(db: SqlStore): Promise<LegacyData> {
  const tables = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  const migrated = tables.some((row) => row.name === 'legacy_contact_requests');
  const contactTable = migrated ? 'legacy_contact_requests' : 'contact_requests';
  const allowedLegacy = new Set(['subscribers', 'contact_requests', 'd1_migrations']);
  if (
    !migrated &&
    tables.some(
      (row) =>
        !allowedLegacy.has(String(row.name)) &&
        !String(row.name).startsWith('sqlite_') &&
        !String(row.name).startsWith('_cf_'),
    )
  ) {
    throw new Error('Unexpected tables in legacy database; inspect before migrating');
  }

  for (const [table, columns] of [
    ['subscribers', legacyColumns.subscribers],
    [contactTable, legacyColumns.contacts],
  ] as const) {
    const info = await db.query(`PRAGMA table_info(${table})`);
    if (info.map((row) => row.name).join(',') !== columns.join(',')) {
      throw new Error(`Unexpected legacy schema: ${table}`);
    }
  }
  return {
    subscribers: await db.query('SELECT * FROM subscribers ORDER BY id'),
    contacts: await db.query(`SELECT * FROM ${contactTable} ORDER BY id`),
  };
}

export function fingerprint(data: LegacyData): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function timestamp(value: unknown, location: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${location}: invalid timestamp`);
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}.000Z`
    : value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      candidate,
    )
  ) {
    throw new Error(`${location}: timestamp needs an explicit timezone`);
  }
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new Error(`${location}: invalid timestamp`);
  // Detect dates that Date would silently roll into a different calendar month.
  const day = candidate.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00.000Z`);
  if (calendar.toISOString().slice(0, 10) !== day)
    throw new Error(`${location}: invalid calendar date`);
  return date.toISOString();
}

function validateFields(row: Row, table: string, required: string[]): void {
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 1)
    throw new Error(`${table}: invalid ID`);
  validateText(row, table);
  for (const key of required) {
    if (typeof row[key] !== 'string')
      throw new Error(`${table} ${row.id}: missing ${key}`);
  }
  timestamp(row.created_at, `${table} ${row.id}: created_at`);
}

function validateText(row: Row, table: string): void {
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id' || key === 'confirmed') continue;
    if (value !== null && (typeof value !== 'string' || value.includes('\0'))) {
      throw new Error(`${table} ${row.id}: invalid ${key}`);
    }
  }
}

function unique(
  value: string,
  seen: Map<string, number>,
  id: number,
  field: string,
): void {
  const previous = seen.get(value);
  if (previous !== undefined)
    throw new Error(`subscribers ${previous}, ${id}: conflicting ${field}`);
  seen.set(value, id);
}

export function preflight(data: LegacyData): void {
  const emails = new Map<string, number>();
  const tokens = new Map<string, number>();
  for (const row of data.subscribers) {
    validateFields(row, 'subscribers', ['email']);
    const email = normalizeEmail(String(row.email));
    if (!validEmail(email)) throw new Error(`subscribers ${row.id}: invalid email`);
    unique(email, emails, Number(row.id), 'normalized email');
    if (row.confirmed !== 0 && row.confirmed !== 1)
      throw new Error(`subscribers ${row.id}: unsupported confirmation state`);
    if (row.confirmation_token !== null) {
      if (row.confirmation_token === '')
        throw new Error(`subscribers ${row.id}: empty token`);
      unique(
        String(row.confirmation_token),
        tokens,
        Number(row.id),
        'confirmation token',
      );
    }
    timestamp(row.confirmed_at, `subscribers ${row.id}: confirmed_at`);
  }
  for (const row of data.contacts)
    validateFields(row, 'contact_requests', ['name', 'phone']);
}
