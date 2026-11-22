// @vitest-environment node
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliStartup, close, listen } from './cli-startup';
import { PollClient } from '../../scripts/polls/client';

const token = 'a'.repeat(64);
it('loads poll .env and sends the invitation as JSON, including its empty object', async () => {
  const summary = { recipients: 2, accepted: 1, failed: 1 };
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push([
      req.method,
      req.url,
      req.headers.authorization,
      req.headers['content-type'],
      Buffer.concat(chunks).toString(),
    ]);
    res.end(JSON.stringify(summary));
  });
  const directory = await mkdtemp(join(tmpdir(), 'poll-cli-'));
  try {
    const origin = await listen(server);
    await expect(
      cliStartup('poll', directory, origin, token, ['invite', 'topics']),
    ).rejects.toMatchObject({
      code: 1,
      stdout: JSON.stringify(summary, null, 2) + '\n',
      stderr: '',
    });
    expect(calls).toEqual([
      [
        'POST',
        '/api/admin/polls/topics/invite',
        `Bearer ${token}`,
        'application/json',
        '{}',
      ],
    ]);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

it('refuses same-origin redirects instead of forwarding the organizer credential', async () => {
  const calls: unknown[] = [];
  const server = createServer((req, res) => {
    calls.push([req.url, req.headers.authorization]);
    if (req.url === '/api/admin/polls') res.writeHead(302, { Location: '/redirected' });
    res.end('{}');
  });
  try {
    const client = new PollClient(token, await listen(server));
    await expect(client.request('')).rejects.toThrow('redirects are refused');
    expect(calls).toEqual([['/api/admin/polls', `Bearer ${token}`]]);
  } finally {
    await close(server);
  }
});
