// @vitest-environment node
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliStartup, close, listen } from './cli-startup';

it('loads event content and API origin from cwd, prefers the environment token and reports partial delivery', async () => {
  const token = 'a'.repeat(64);
  const calls: unknown[] = [];
  const preview = {
    recipients: 1,
    subject: 'Meeting',
    text: 'Bring a laptop.',
    html: '<p>Bring a laptop.</p>',
  };
  const summary = { recipients: 2, accepted: 1, failed: 1 };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push([
      req.method,
      req.url,
      req.headers.authorization,
      req.headers['content-type'],
      JSON.parse(Buffer.concat(chunks).toString()),
    ]);
    res.end(JSON.stringify(req.url?.endsWith('/preview') ? preview : summary));
  });
  const directory = await mkdtemp(join(tmpdir(), 'event-cli-'));
  try {
    const origin = await listen(server);
    await mkdir(join(directory, 'content/events'), { recursive: true });
    const fields = {
      title: 'Meeting',
      date: '2026-10-17T17:00:00.000Z',
      location: 'Library',
      status: 'published',
      inviteTags: ['member'],
      inviteMessage: 'Bring a laptop.',
    };
    await writeFile(
      join(directory, 'content/events/meeting.md'),
      `---\n${JSON.stringify({ ...fields, organizer: 'Chapter', tags: [] })}\n---\n`,
    );
    const fileToken = 'c'.repeat(64);
    const success = await cliStartup(
      'events',
      directory,
      origin,
      fileToken,
      ['invite', 'meeting', '--dry-run'],
      { defaultEnvFile: true },
    );
    expect(success.stdout).toBe(JSON.stringify(preview, null, 2) + '\n');
    expect(success.stderr).toBe('');
    // The explicit file must win over this unusable default origin.
    await writeFile(join(directory, '.env'), 'AINOOGA_API_URL=not-an-origin\n');
    const updated = { ...fields, inviteMessage: 'Updated locally.' };
    await writeFile(
      join(directory, 'content/events/meeting.md'),
      `---\n${JSON.stringify({ ...updated, organizer: 'Chapter', tags: [] })}\n---\n`,
    );
    const run = cliStartup(
      'events',
      directory,
      origin,
      'b'.repeat(64),
      ['invite', 'meeting'],
      { envToken: token },
    );
    await expect(run).rejects.toMatchObject({
      code: 1,
      stdout: JSON.stringify(summary, null, 2) + '\n',
      stderr: '',
    });
    expect(calls).toEqual([
      [
        'POST',
        '/api/admin/events/meeting/invite/preview',
        `Bearer ${fileToken}`,
        'application/json',
        fields,
      ],
      [
        'POST',
        '/api/admin/events/meeting/invite',
        `Bearer ${token}`,
        'application/json',
        updated,
      ],
    ]);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});
