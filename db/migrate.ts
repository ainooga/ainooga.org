import { readFile } from 'node:fs/promises';
import { migrationStatements, verifyChapterDefinitions } from './schema.js';
import type { SqlStore } from './types.js';

interface MigrationStore extends SqlStore {
  remote: boolean;
  applyMigrations(): void | Promise<void>;
}

export async function verifyLive(db: SqlStore): Promise<void> {
  await verifyChapterDefinitions(db);
  const sql = (
    await Promise.all(
      ['0003_voter_auth.sql', '0004_poll_api.sql'].map((name) =>
        readFile(`migrations/${name}`, 'utf8'),
      ),
    )
  ).join('\n');
  const definitions = await db.query(
    "SELECT name,sql FROM sqlite_master WHERE type IN ('table','index')",
  );
  const actual = new Map(definitions.map((row) => [row.name, String(row.sql)]));
  for (const statement of migrationStatements(sql)) {
    const name = /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) (\w+)/.exec(statement)?.[1];
    if (name !== undefined && normalize(actual.get(name) ?? '') !== normalize(statement))
      throw new Error(`Unexpected API schema definition: ${name}`);
  }
  if ((await db.query('PRAGMA foreign_key_check')).length > 0)
    throw new Error('Foreign-key check failed');
  const rows = await db.query('PRAGMA quick_check');
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok')
    throw new Error('Integrity check failed');
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export async function migrate(db: MigrationStore): Promise<void> {
  const rows = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = rows
    .map((row) => String(row.name))
    .filter(
      (name) =>
        !name.startsWith('_cf_') &&
        !name.startsWith('sqlite_') &&
        name !== 'd1_migrations',
    );
  if (names.includes('people')) {
    await verifyChapterDefinitions(db);
  } else if (db.remote || names.length > 0) {
    throw new Error(
      'Complete the legacy chapter cutover before routine migrations. Only an empty local database can be initialized automatically.',
    );
  }
  await db.applyMigrations();
  await verifyLive(db);
}
