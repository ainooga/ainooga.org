import { verifyChapterDefinitions } from './schema.js';
import { isDeepStrictEqual } from 'node:util';
import { fingerprint, preflight, readLegacy } from './legacy.js';
import { transform } from './transform.js';
import {
  insertSql,
  type ExpectedRow,
  type Manifest,
  type Row,
  type SqlStore,
} from './types.js';

export const chapterTables = [
  'people',
  'person_identifiers',
  'person_sources',
  'memberships',
  'person_tags',
  'organizer_permissions',
  'organizations',
  'organization_people',
  'sponsorships',
  'subscriptions',
  'contact_requests',
  'events',
  'event_links',
  'event_participation',
  'polls',
  'poll_options',
  'poll_allowlist',
  'poll_ballots',
  'poll_ballot_choices',
];

async function expectedRows(db: SqlStore, manifest: Manifest): Promise<ExpectedRow[]> {
  const data = await readLegacy(db);
  preflight(data);
  if (fingerprint(data) !== manifest.fingerprint)
    throw new Error('Legacy data changed since preflight; stop and reconcile');
  return transform(data, manifest.migratedAt);
}

export async function checkTableSet(db: SqlStore): Promise<void> {
  const rows = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = rows
    .map((row) => String(row.name))
    .filter(
      (name) =>
        !name.startsWith('_cf_') &&
        !name.startsWith('sqlite_') &&
        name !== 'd1_migrations',
    );
  const expected = [...chapterTables, 'subscribers', 'legacy_contact_requests'];
  names.sort((a, b) => a.localeCompare(b));
  expected.sort((a, b) => a.localeCompare(b));
  if (!isDeepStrictEqual(names, expected))
    throw new Error('Unexpected chapter schema table set');
  await verifyChapterDefinitions(db);
}

function missingRows(
  table: string,
  expected: ExpectedRow[],
  actual: Row[],
  complete: boolean,
): ExpectedRow[] {
  const byId = new Map(expected.map((item) => [item.row.id, item]));
  for (const row of actual) {
    const wanted = byId.get(row.id);
    if (wanted === undefined || !isDeepStrictEqual(row, wanted.row)) {
      throw new Error(
        `${table} ${row.id ?? '(unknown)'}: target differs from migration; stop and reconcile`,
      );
    }
    byId.delete(row.id);
  }
  if (complete && byId.size > 0)
    throw new Error(`${table}: missing ${byId.size} migrated rows`);
  return [...byId.values()];
}

async function compare(
  db: SqlStore,
  expected: ExpectedRow[],
  complete: boolean,
): Promise<ExpectedRow[]> {
  const missing: ExpectedRow[] = [];
  for (const table of chapterTables) {
    const rows = await db.query(`SELECT * FROM ${table}`);
    missing.push(
      ...missingRows(
        table,
        expected.filter((item) => item.table === table),
        rows,
        complete,
      ),
    );
  }
  return missing;
}

export async function backfill(db: SqlStore, manifest: Manifest): Promise<void> {
  await checkTableSet(db);
  const expected = await expectedRows(db, manifest);
  // Validate every existing row before making any writes. Inserts follow the
  // dependency order above; a partially executed CLI file is safe to resume.
  const missing = await compare(db, expected, false);
  for (let offset = 0; offset < missing.length; offset += 25) {
    await db.execute(missing.slice(offset, offset + 25).map(insertSql));
  }
  await verify(db, manifest);
}

export async function verify(db: SqlStore, manifest: Manifest): Promise<void> {
  await checkTableSet(db);
  await compare(db, await expectedRows(db, manifest), true);
  if ((await db.query('PRAGMA foreign_key_check')).length !== 0)
    throw new Error('Foreign-key check failed');
  const integrity = await db.query('PRAGMA quick_check');
  if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok')
    throw new Error('Database integrity check failed');
}
