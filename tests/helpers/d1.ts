import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import type { Row, SqlStore } from '../../db/types';

export class D1Store implements SqlStore {
  constructor(readonly db: D1Database) {}
  async query(sql: string): Promise<Row[]> {
    return (await this.db.prepare(sql).all<Row>()).results;
  }
  async execute(statements: string[]): Promise<void> {
    if (statements.length > 0)
      await this.db.batch(statements.map((sql) => this.db.prepare(sql)));
  }
}

export async function database() {
  const mf = new Miniflare({
    host: '127.0.0.1',
    modules: true,
    script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: '2026-06-22',
    d1Databases: { DB: 'chapter-test' },
  });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  return { db, store: new D1Store(db), dispose: () => mf.dispose() };
}

export async function migration(store: SqlStore, name: string): Promise<void> {
  const sql = await readFile(`migrations/${name}`, 'utf8');
  await store.execute(
    sql
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function chapterDatabase() {
  const context = await database();
  await migration(context.store, '0001_create_subscribers.sql');
  await migration(context.store, '0002_chapter_schema.sql');
  return context;
}
