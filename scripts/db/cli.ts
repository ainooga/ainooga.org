import { localSize } from './size.js';
import { backfill, verify } from './backfill.js';
import { loadManifest, prepare } from './manifest.js';
import { WranglerStore } from './wrangler.js';

async function requireMaintenance(): Promise<void> {
  for (const path of ['/api/subscribe', '/api/contact-sponsor', '/confirm']) {
    const method = path === '/confirm' ? 'GET' : 'POST';
    const response = await fetch(`https://ainooga.org${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (
      response.status !== 503 ||
      response.headers.get('X-Chapter-Maintenance') !== 'true'
    ) {
      throw new Error(
        'Production handlers must be in chapter maintenance mode before migration writes',
      );
    }
  }
}

async function size(db: WranglerStore): Promise<void> {
  if (db.remote) {
    db.remoteInfo();
    return;
  }
  const bytes = await localSize();
  console.log(
    JSON.stringify({ bytes, mb: bytes / 1e6, percentOf500MB: bytes / 5e6 }, null, 2),
  );
}

async function migrate(db: WranglerStore, target: string): Promise<void> {
  const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table'");
  const userTables = tables.filter(
    (row) =>
      !String(row.name).startsWith('_cf_') &&
      !String(row.name).startsWith('sqlite_') &&
      row.name !== 'd1_migrations',
  );
  const hasLegacy = tables.some((row) => row.name === 'subscribers');
  if (!hasLegacy && (db.remote || userTables.length !== 0)) {
    throw new Error(
      'Legacy database missing or unexpected tables present; inspect before initializing',
    );
  }
  if (hasLegacy) await prepare(db, target);
  db.applyMigrations();
  const manifest = await prepare(db, target);
  await backfill(db, manifest);
}

async function main(): Promise<void> {
  const [command, ...flags] = process.argv.slice(2);
  validateFlags(flags);
  const remote = flags.includes('--remote');
  const target = remote ? 'remote-ainooga-d1' : 'local-ainooga-d1';
  const db = new WranglerStore(remote);
  if (remote && (command === 'migrate' || command === 'backfill'))
    await requireMaintenance();
  await dispatch(command, db, target);
  console.log(`${command} completed (${remote ? 'remote' : 'local'}).`);
}

async function dispatch(
  command: string | undefined,
  db: WranglerStore,
  target: string,
): Promise<void> {
  switch (command) {
    case 'preflight':
      await prepare(db, target);
      break;
    case 'migrate':
      await migrate(db, target);
      break;
    case 'backfill':
      await backfill(db, loadManifest(target));
      break;
    case 'verify':
      await verify(db, loadManifest(target));
      break;
    case 'size':
      await size(db);
      break;
    default:
      throw new Error('Expected preflight, migrate, backfill, verify, or size');
  }
}

function validateFlags(flags: string[]): void {
  if (
    flags.some((flag) => flag !== '--local' && flag !== '--remote') ||
    (flags.includes('--local') && flags.includes('--remote'))
  ) {
    throw new Error('Use --local (default) or --remote, with no other flags');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database operation failed');
  process.exitCode = 1;
});
