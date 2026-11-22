// @vitest-environment node
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliStartup, close, listen } from './cli-startup';

it('loads the organizer token from cwd .env without Cloudflare credentials', async () => {
  const token = 'a'.repeat(64);
  const calls: unknown[] = [];
  const server = createServer((request, response) => {
    calls.push([request.method, request.url, request.headers.authorization]);
    response.end(JSON.stringify({ name: 'Test organizer', personId: 1 }));
  });
  const directory = await mkdtemp(join(tmpdir(), 'organizer-cli-'));
  try {
    const result = await cliStartup(
      'api-whoami',
      directory,
      await listen(server),
      token,
      [],
    );
    expect(calls).toEqual([['GET', '/api/admin/me', `Bearer ${token}`]]);
    expect(result.stdout.trim()).toBe('Authenticated as Test organizer (person 1).');
    expect(result.stderr).toBe('');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});
