// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authFixture, ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
const cliScript = resolve('scripts/events.ts');
const tsxLoader = createRequire(import.meta.url).resolve('tsx');

let f: Awaited<ReturnType<typeof authFixture>>;
let directory: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  await f?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('runs the real invitation CLI through HTTP and D1 for preview, delivery and partial failure', async () => {
  f = await authFixture();
  f.env.POLLS_READY = 'false';
  const sent: string[] = [];
  let reject = false;
  f.env.EMAIL = {
    async send(message) {
      sent.push(String(message.to));
      if (reject) throw new Error('Private provider details');
      return { messageId: String(sent.length) };
    },
  };
  await f.store.execute(["INSERT INTO person_tags VALUES(2,'member')"]);
  directory = await mkdtemp(join(tmpdir(), 'event-invite-cli-'));
  await mkdir(join(directory, 'content/events'), { recursive: true });
  const eventFile = join(directory, 'content/events/meeting.md');
  const fields = {
    title: 'Chapter meeting',
    date: '2026-10-17T17:00:00Z',
    location: 'Library',
    organizer: 'Chapter',
    tags: ['workshop'],
    status: 'published',
    inviteTags: ['member'],
    inviteMessage: 'Bring a laptop.',
  };
  const writeEvent = (overrides = {}) =>
    writeFile(eventFile, `---\n${JSON.stringify({ ...fields, ...overrides })}\n---\n`);
  await writeEvent();
  const requests: {
    path: string;
    method: string | undefined;
    contentType: string | undefined;
    body: string;
  }[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    requests.push({
      path: request.url!,
      method: request.method,
      contentType: request.headers['content-type'],
      body: body.toString(),
    });
    const result = await handleAuth(
      new Request(`${SITE}${request.url!}`, {
        method: request.method,
        body: new Uint8Array(body),
        headers: {
          Authorization: request.headers.authorization ?? '',
          'Content-Type': request.headers['content-type'] ?? '',
        },
      }),
      f.env,
      f.deps,
      f.deps,
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const envFile = join(directory, '.env');
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(
    envFile,
    `AINOOGA_API_TOKEN=${ORGANIZER_TOKEN}\nAINOOGA_API_URL=${apiUrl}\n`,
    { mode: 0o600 },
  );
  const cli = (
    extra: string[] = [],
    overrides: Record<string, string | undefined> = {},
  ) =>
    promisify(execFile)(
      process.execPath,
      [
        '--import',
        tsxLoader,
        cliScript,
        '--env-file',
        envFile,
        'invite',
        'meeting',
        ...extra,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          AINOOGA_API_TOKEN: undefined,
          AINOOGA_API_URL: undefined,
          ...overrides,
        },
      },
    ).then(
      (result) => ({ ...result, code: 0 }),
      (error: { stdout: string; stderr: string; code: number }) => error,
    );
  const preview = await cli(['--dry-run']);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({
    recipients: 1,
    text: expect.stringContaining('Bring a laptop.'),
  });
  expect(sent).toEqual([]);
  await writeEvent({ inviteMessage: 'Updated locally.' });
  const delivered = await cli();
  expect(delivered.code).toBe(0);
  expect(JSON.parse(delivered.stdout)).toEqual({ recipients: 1, accepted: 1, failed: 0 });
  reject = true;
  const failed = await cli();
  expect(failed.code).toBe(1);
  expect(JSON.parse(failed.stdout)).toEqual({ recipients: 1, accepted: 0, failed: 1 });
  expect(sent).toEqual(['voter@example.com', 'voter@example.com']);
  const override = await cli(['--dry-run'], { AINOOGA_API_TOKEN: 'b'.repeat(64) });
  expect(override.code).toBe(1);
  expect(override.stderr).toContain('HTTP 401');
  expect((await cli(['--remote'])).code).toBe(1);
  expect(requests.map((request) => request.path)).toEqual([
    '/api/admin/events/meeting/invite/preview',
    '/api/admin/events/meeting/invite',
    '/api/admin/events/meeting/invite',
    '/api/admin/events/meeting/invite/preview',
  ]);
  for (const request of requests)
    expect(request).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
    });
  expect(JSON.parse(requests[1]!.body).inviteMessage).toBe('Updated locally.');
  expect(JSON.parse(requests[0]!.body)).not.toHaveProperty('organizer');
  await writeEvent({ status: 'draft' });
  expect((await cli(['--dry-run'])).code).toBe(1);
  expect(requests).toHaveLength(4);
  await rm(eventFile);
  expect((await cli(['--dry-run'])).stderr).toContain('Event not found');
  expect(requests).toHaveLength(4);
  expect(await f.store.query('SELECT * FROM events')).toEqual([]);
  const output = [preview, delivered, failed, override]
    .map((result) => result.stdout + result.stderr)
    .join('');
  expect(output).not.toContain(ORGANIZER_TOKEN);
  expect(output).not.toContain('voter@example.com');
  expect(output).not.toContain('Private provider details');
});
