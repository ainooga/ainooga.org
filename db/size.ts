import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

export async function localSize(): Promise<number> {
  const directory = resolve('worker/.wrangler/state/v3/d1');
  const entries = await readdir(resolve(directory, 'miniflare-D1DatabaseObject'));
  if (!entries.some((entry) => entry.endsWith('.sqlite'))) {
    throw new Error('Local D1 database not initialized; run pnpm cf:migrate:local');
  }
  const config = await readFile('worker/wrangler.toml', 'utf8');
  const ids = [...config.matchAll(/^database_id\s*=\s*"([^"]+)"/gm)];
  const id = ids[0]?.[1];
  if (ids.length !== 1 || id === undefined)
    throw new Error('Expected exactly one Worker D1 database');
  // Wrangler hides size_after in its local JSON output. Use the same Miniflare
  // binding ID and v3 persistence directory to obtain allocated pages including WAL.
  const mf = new Miniflare({
    host: '127.0.0.1',
    modules: true,
    compatibilityDate: '2026-06-22',
    script: 'export default { fetch() { return new Response("size"); } };',
    d1Databases: { DB: id },
    d1Persist: directory,
  });
  try {
    const db = await mf.getD1Database('DB');
    const result = await db.prepare('SELECT 1').all();
    return result.meta.size_after;
  } finally {
    await mf.dispose();
  }
}
