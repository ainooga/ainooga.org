import { readFile, stat } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { WranglerStore } from '../db/wrangler.js';
import { literal } from '../db/types.js';
import {
  exportedSessionCookies,
  encryptSession,
} from '../worker/src/member-sync/session.js';
import { AicTransport, checkSession } from '../worker/src/member-sync/source.js';
import { SyncError } from '../worker/src/member-sync/state.js';

function options() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      'env-file': { type: 'string' },
    },
  });
  const remote = values.remote === true;
  const envFile = values['env-file'];
  if (
    positionals.length !== 1 ||
    remote === (values.local === true) ||
    envFile === undefined ||
    envFile === ''
  )
    throw new SyncError(
      'Usage: pnpm member-sync:session --local|--remote --env-file <private.env> <cookies.json>',
    );
  return { remote, envFile, path: positionals[0]! };
}

async function main(): Promise<void> {
  const { remote, envFile, path } = options();
  loadEnvFile(envFile);
  const secret = process.env.AIC_SESSION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new SyncError('Set AIC_SESSION_KEY to 64 hexadecimal characters.');
  if ((await stat(path)).size > 1024 * 1024)
    throw new SyncError('Cookie export exceeds 1 MiB.');
  const cookies = exportedSessionCookies(JSON.parse(await readFile(path, 'utf8')));
  const transport = new AicTransport({
    cookies,
    now: Date.now,
    fetch: (request) => fetch(request),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    save: async () => {},
  });
  await checkSession(
    transport,
    process.env.AIC_BOT_EMAIL ?? 'bot@ainooga.org',
    Date.now(),
  );
  const encrypted = await encryptSession(cookies, secret);
  const rows = await new WranglerStore(remote).query(
    `UPDATE member_sync_state SET session_ciphertext=${literal(encrypted)},last_error=NULL,
    next_run_at=CASE WHEN roster IS NULL THEN 0 ELSE next_run_at END
    WHERE id=1 AND lease_until<=${Date.now()} RETURNING session_ciphertext`,
  );
  if (rows.length !== 1 || rows[0]?.session_ciphertext !== encrypted)
    throw new SyncError(
      'Session not imported: the sync is busy or migration 0006 is missing.',
    );
  console.log(`Session validated and imported into ${remote ? 'remote' : 'local'} D1.`);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SyncError
      ? error.code
      : 'Session import failed. Check the file, environment, migration, and D1 access.',
  );
  process.exitCode = 1;
});
