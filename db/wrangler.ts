import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Row, SqlStore } from './types.js';

export const persistence = resolve('worker/.wrangler/state');
const config = resolve('worker/wrangler.toml');

export class WranglerStore implements SqlStore {
  constructor(
    readonly remote: boolean,
    readonly atomicWrites = false,
  ) {}

  private run(args: string[]): string {
    try {
      return execFileSync(
        process.execPath,
        [resolve('node_modules/wrangler/bin/wrangler.js'), ...args],
        {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch {
      // Wrangler errors may echo SQL or private values. Do not print them.
      throw new Error(
        'Wrangler operation failed. Check authentication/configuration and retry while maintenance remains active.',
      );
    }
  }

  private withSql(sql: string, atomic = false): string {
    // Remote --file uses bulk import and returns an import summary, not rows.
    // Use the query API for remote reads and the small backfill batches.
    if (this.remote && !atomic) {
      return this.run([
        'd1',
        'execute',
        'ainooga-d1',
        '--config',
        config,
        '--remote',
        '--command',
        sql,
        '--json',
        '--yes',
      ]);
    }
    mkdirSync('backups', { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(resolve('backups/db-operation-'));
    const file = resolve(directory, 'query.sql');
    try {
      writeFileSync(file, sql, { mode: 0o600 });
      const target = this.remote
        ? ['--remote']
        : ['--local', '--persist-to', persistence];
      return this.run([
        'd1',
        'execute',
        'ainooga-d1',
        '--config',
        config,
        ...target,
        '--file',
        file,
        '--json',
        '--yes',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  async query(sql: string): Promise<Row[]> {
    const output: unknown = JSON.parse(this.withSql(sql));
    if (!Array.isArray(output) || output.length !== 1)
      throw new Error('Unexpected Wrangler query response');
    const result = output[0] as { success?: boolean; results?: Row[] };
    if (result.success !== true || !Array.isArray(result.results))
      throw new Error('Wrangler query failed');
    return result.results;
  }

  async execute(statements: string[]): Promise<void> {
    if (statements.length === 0) return;
    // Remote file imports roll back on failure; they briefly pause D1 access.
    const output: unknown = JSON.parse(
      this.withSql(`${statements.join(';\n')};`, this.atomicWrites),
    );
    if (
      !Array.isArray(output) ||
      output.some((item: { success?: boolean }) => item.success !== true)
    ) {
      throw new Error(
        'Wrangler write failed; keep maintenance enabled and rerun verification',
      );
    }
  }

  applyMigrations(): void {
    const target = this.remote ? ['--remote'] : ['--local', '--persist-to', persistence];
    this.run(['d1', 'migrations', 'apply', 'ainooga-d1', '--config', config, ...target]);
  }

  remoteInfo(): void {
    // The info command contains database metadata, never row values.
    console.log(this.run(['d1', 'info', 'ainooga-d1', '--config', config]));
  }
}
