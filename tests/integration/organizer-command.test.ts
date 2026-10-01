// @vitest-environment node
import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('loads an organizer token from .env and authenticates without Cloudflare credentials', async () => {
  const token = 'a'.repeat(64);
  let received = '';
  const server = createServer((request, response) => {
    received = request.headers.authorization ?? '';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ name: 'Test organizer', personId: 1 }));
  });
  const directory = await mkdtemp(join(tmpdir(), 'ainooga-api-test-'));
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    const envFile = join(directory, '.env');
    await writeFile(
      envFile,
      `AINOOGA_API_TOKEN=${token}\nAINOOGA_API_URL=http://127.0.0.1:${address.port}\n`,
      { mode: 0o600 },
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        `--env-file=${envFile}`,
        resolve('scripts/api-whoami.ts'),
      ],
      { env: { PATH: process.env.PATH }, timeout: 15000 },
    );
    expect(received).toBe(`Bearer ${token}`);
    expect(result.stdout).toContain('Authenticated as Test organizer (person 1).');
    expect(result.stdout + result.stderr).not.toContain(token);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
