import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import type { Row, SqlStore } from '../../db/types';

export class D1Store implements SqlStore {
  constructor(
    readonly db: D1Database,
    readonly applyMigration?: (sql: string[]) => Promise<void>,
  ) {}
  async query(sql: string): Promise<Row[]> {
    return (await this.db.prepare(sql).all<Row>()).results;
  }
  async execute(statements: string[]): Promise<void> {
    if (statements.length > 0)
      await this.db.batch(statements.map((sql) => this.db.prepare(sql)));
  }
}

// Prepare each migration's unchanged atomic batch inside workerd, not across one
// synchronous Miniflare RPC per statement. Only file-scoped test DBs enable this.
const migrationWorker = `export default { async fetch(request, env) {
  if (request.headers.get('Authorization') !== env.TOKEN) return new Response(null, {status: 403});
  const { name, statements } = await request.json();
  if (!/^CASE_[0-9]+$/.test(name) || !Object.hasOwn(env, name)) return new Response(null, {status: 400});
  const db = env[name];
  try {
    await db.batch(statements.map(sql => db.prepare(sql)));
    return new Response(null, {status: 204});
  } catch (error) { return new Response(error.message, {status: 400}); }
} };`;

function runtime(
  d1Databases: Record<string, string>,
  persistence?: string,
  token?: string,
) {
  return new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      cf: false,
      modules: true,
      bindings: token ? { TOKEN: token } : {},
      script: token
        ? migrationWorker
        : 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: '2026-06-22',
      d1Databases,
      d1Persist: persistence,
    }),
  );
}

async function binding(mf: Miniflare, name: string, dispose: () => Promise<void>) {
  const db = (await mf.getD1Database(name)) as unknown as D1Database;
  return { db, store: new D1Store(db), dispose };
}

// A file owns the runtime. Each allocation consumes a binding; never reset/recycle it.
export function bindingPool(size: number) {
  const keys = Array.from({ length: size }, (_, i) => `CASE_${i}`);
  const token = crypto.randomUUID();
  const mf = runtime(Object.fromEntries(keys.map((key) => [key, key])), undefined, token);
  const active = new Set<string>();
  return {
    async open() {
      const name = keys.pop();
      if (!name) throw new Error('No fresh D1 binding left');
      const raw = (await mf.getD1Database(name)) as unknown as D1Database;
      // Reject later entry through the released DB handle. Already-prepared statements
      // still refer only to this case's never-reused binding, not to the next case.
      const lease = Proxy.revocable(raw, {
        get(target, key) {
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      active.add(name);
      return {
        db: lease.proxy,
        store: new D1Store(lease.proxy, async (statements) => {
          if (!active.has(name)) throw new Error(`D1 fixture disposed: ${name}`);
          const response = await mf.dispatchFetch('http://localhost/migration', {
            method: 'POST',
            headers: { Authorization: token },
            body: JSON.stringify({ name, statements }),
          });
          if (!response.ok) throw new Error(await response.text());
        }),
        async dispose() {
          lease.revoke();
          active.delete(name);
        },
      };
    },
    async dispose() {
      await mf.dispose();
      if (active.size)
        throw new Error(`D1 fixtures not disposed: ${[...active].join(', ')}`);
    },
  };
}

export async function database(persistence?: string) {
  const mf = runtime({ DB: 'chapter-test' }, persistence);
  try {
    return await binding(mf, 'DB', () => mf.dispose());
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

export async function initialize<T extends { dispose(): Promise<void> }, U>(
  resource: T,
  setup: (resource: T) => Promise<U>,
) {
  try {
    return await setup(resource);
  } catch (error) {
    await resource.dispose();
    throw error;
  }
}

export async function migration(store: SqlStore, name: string): Promise<void> {
  const sql = await readFile(`migrations/${name}`, 'utf8');
  const statements = sql
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (store instanceof D1Store && store.applyMigration)
    await store.applyMigration(statements);
  else await store.execute(statements);
}

export async function chapterDatabase(open = database) {
  return initialize(await open(), async (context) => {
    await migration(context.store, '0001_create_subscribers.sql');
    await migration(context.store, '0002_chapter_schema.sql');
    return context;
  });
}
