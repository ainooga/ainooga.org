import { verifyCurrentDefinitions } from './current-schema.js';
import { reconcileLegacy } from './reconcile.js';
import { verifyChapterDefinitions } from './schema.js';
import type { SqlStore } from './types.js';

interface MigrationStore extends SqlStore {
  remote: boolean;
  applyMigrations(): void | Promise<void>;
}

export async function verifyLive(db: SqlStore): Promise<void> {
  await verifyCurrentDefinitions(db);
  if ((await db.query('PRAGMA foreign_key_check')).length > 0)
    throw new Error('Foreign-key check failed');
  const rows = await db.query('PRAGMA quick_check');
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok')
    throw new Error('Integrity check failed');
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
    if (names.includes('memberships')) {
      await verifyChapterDefinitions(db);
      await reconcileLegacy(db);
    } else {
      await verifyLive(db);
    }
  } else if (db.remote || names.length > 0) {
    throw new Error(
      'Complete the legacy chapter cutover before routine migrations. Only an empty local database can be initialized automatically.',
    );
  }
  await db.applyMigrations();
  await verifyLive(db);
}
