// Playwright owns this process. No Worker credentials, hosted providers or content build.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { database, migration } from './d1';
import { BackgroundTasks } from './background';
import { handleAuth } from '../../worker/src/auth/router';
import { authDependencies } from '../../worker/src/auth/providers';
import type { Env } from '../../worker/src/types';

async function seed(f: Awaited<ReturnType<typeof database>>) {
  for (const file of (await readdir('migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await migration(f.store, file);
  await f.store.execute([
    "INSERT INTO people (id,name) VALUES (1,'A'),(2,'B')",
    `INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES
       (1,'email','a@example.com','a@example.com'),(2,'email','b@example.com','b@example.com')`,
    `INSERT INTO polls (id,slug,title,status,identity_mode,min_selections,max_selections,
       results_visibility,allowed_person_ids,starts_at,ends_at,created_by) VALUES
       (1,'topics','Next talk','published','honor',1,1,'after_vote','[1,2]',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'),1)`,
    `INSERT INTO poll_options (id,poll_id,label,normalized_label,origin) VALUES (1,1,'Robotics','robotics','predefined')`,
  ]);
}

function voterHandler(db: D1Database, tasks: BackgroundTasks, origin: string) {
  const allow = { limit: async () => ({ success: true }) };
  const env: Env = {
    DB: db,
    SITE_URL: origin,
    POLLS_READY: 'true',
    AUTH_READY: 'true',
    CHAPTER_SCHEMA_READY: 'true',
    AUTH_SECRET: 's'.repeat(64),
    TURNSTILE_SECRET_KEY: 'unused',
    EMAIL: {
      async send() {
        throw new Error('Unexpected email');
      },
    },
    AUTH_RATE_LIMITER: allow,
    AUTH_INITIATION_RATE_LIMITER: allow,
  };
  const deps = authDependencies(env, tasks, async () => {
    throw new Error('External network disabled');
  });
  deps.verifyBot = async (token) => token === 'local-proof';
  return (req: Request) => handleAuth(req, env, tasks, deps);
}

async function api(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  handle: ReturnType<typeof voterHandler>,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(',') : value);
  }
  const response = await handle(
    new Request(`${origin}${req.url!}`, {
      method: req.method,
      headers,
      body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined,
    }),
  );
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(await response.text());
}

export async function withPollServer(use: (origin: string) => Promise<void>) {
  const start = performance.now();
  const cleanup: (() => Promise<unknown>)[] = [];
  try {
    const f = await database();
    cleanup.push(f.dispose);
    await seed(f);
    console.log(
      `Poll D1 migrated and seeded in ${Math.round(performance.now() - start)} ms`,
    );
    const cacheDir = await mkdtemp(join(tmpdir(), 'poll-vite-'));
    cleanup.push(() => rm(cacheDir, { recursive: true, force: true }));
    const vite = await createViteServer({
      configFile: false,
      envDir: false,
      publicDir: false,
      cacheDir,
      // Avoid an esbuild prebundle outliving fixture cleanup on an interrupted run.
      optimizeDeps: { noDiscovery: true, exclude: ['svelte'] },
      plugins: [svelte({ prebundleSvelteLibraries: false })],
      resolve: { alias: { $lib: resolve('src/lib') } },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    });
    cleanup.push(() => vite.close());
    const tasks = new BackgroundTasks();
    cleanup.push(() => tasks.drain());
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    cleanup.push(
      () =>
        new Promise<void>((done, fail) => {
          server.close((error) => (error ? fail(error) : done()));
          server.closeAllConnections();
        }),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    const origin = `http://127.0.0.1:${address.port}`;
    const handle = voterHandler(f.db, tasks, origin);
    server.on('request', (req, res) => {
      if (!req.url?.startsWith('/api/')) return vite.middlewares(req, res);
      api(req, res, origin, handle).catch((error: unknown) => {
        console.error(error);
        res.writeHead(500).end('Poll test server error');
      });
    });
    console.log(`Poll ready: ${origin}`);
    await use(origin);
  } finally {
    await dispose(cleanup);
  }
}

async function dispose(cleanup: (() => Promise<unknown>)[]) {
  const start = performance.now();
  const errors: unknown[] = [];
  for (const close of cleanup.reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Poll fixture teardown failed');
  console.log(`Poll fixture disposed in ${Math.round(performance.now() - start)} ms`);
}
