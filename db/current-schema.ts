import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { SqlStore } from './types.js';

interface Definition {
  type: string;
  name: string;
  sql: string;
}
function normalizedSql(sql: string): string {
  // Ignore engine formatting while preserving whitespace inside SQL literals.
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\s+/g, (token) => {
    if (/^\s/.test(token)) return '';
    return /^"\w+"$/.test(token) ? token.slice(1, -1) : token;
  });
}
function normalized(rows: Definition[]): Definition[] {
  return rows
    .map((row) => ({
      ...row,
      sql: normalizedSql(row.sql),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function verifyCurrentDefinitions(
  db: SqlStore,
  allowPrevious = false,
): Promise<void> {
  const rows =
    await db.query(`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL
    AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name != 'd1_migrations'`);
  const actual = rows.map((row) => ({
    type: String(row.type),
    name: String(row.name),
    sql: String(row.sql),
  }));
  const expected = JSON.parse(await readFile('db/schema-current.json', 'utf8')) as {
    definitions: Definition[];
  };
  if (allowPrevious && !actual.some((row) => row.name === 'member_sync_state'))
    expected.definitions = expected.definitions.filter(
      (row) => row.name !== 'member_sync_state',
    );
  if (!isDeepStrictEqual(normalized(actual), normalized(expected.definitions)))
    throw new Error(
      'Unexpected current schema definitions; compare with the versioned migrations',
    );
}
