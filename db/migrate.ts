import { verifyCurrentDefinitions } from './current-schema.js';
import { reconcileLegacy } from './reconcile.js';
import { verifyChapterDefinitions } from './schema.js';
import type { SqlStore } from './types.js';

interface MigrationStore extends SqlStore {
  remote: boolean;
  applyMigrations(): void | Promise<void>;
}

export async function verifyLive(db: SqlStore, allowPrevious = false): Promise<void> {
  await verifyCurrentDefinitions(db, allowPrevious);
  if ((await db.query('PRAGMA foreign_key_check')).length > 0)
    throw new Error('Foreign-key check failed');
  const rows = await db.query('PRAGMA quick_check');
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok')
    throw new Error('Integrity check failed');
}

async function checkOrganizationNames(db: SqlStore): Promise<void> {
  const collisions = await db.query(`SELECT group_concat(id, ', ') AS ids
    FROM (SELECT id,lower(trim(name)) AS name_key FROM organizations ORDER BY id)
    GROUP BY name_key HAVING count(*) > 1 ORDER BY min(id)`);
  if (collisions.length > 0) {
    const groups = collisions.map((row) => `[${row.ids}]`).join('; ');
    throw new Error(
      `Organization name collisions for IDs ${groups} under lower(trim(name)). Rename distinct organizations or reconcile duplicates while preserving sponsorships and person relationships, then rerun migration. No reconciliation or migration writes were made.`,
    );
  }
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
      await checkOrganizationNames(db);
      await reconcileLegacy(db);
    } else {
      await verifyLive(db, true);
    }
  } else if (db.remote || names.length > 0) {
    throw new Error(
      'Complete the legacy chapter cutover before routine migrations. Only an empty local database can be initialized automatically.',
    );
  }
  await db.applyMigrations();
  await verifyLive(db);
}
