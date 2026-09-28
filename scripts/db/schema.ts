import { readFile } from 'node:fs/promises';
import type { SqlStore } from './types.js';

export function migrationStatements(sql: string): string[] {
  // Versioned schema files contain no semicolons in string literals.
  return sql
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export async function verifyChapterDefinitions(db: SqlStore): Promise<void> {
  const sql = await readFile('migrations/0002_chapter_schema.sql', 'utf8');
  const definitions = await db.query(
    "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index')",
  );
  const actual = new Map(definitions.map((row) => [row.name, String(row.sql)]));
  for (const statement of migrationStatements(sql)) {
    const match = /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) (\w+)/.exec(statement);
    if (match === null) continue;
    const name = match[1] ?? '';
    if (normalized(actual.get(name) ?? '') !== normalized(statement)) {
      throw new Error(`Unexpected chapter schema definition: ${name}`);
    }
  }
}
