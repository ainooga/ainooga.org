// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pollFixture, submission } from '../helpers/polls';
import { ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { PollClient } from '../../scripts/polls/client';
import { handleAuth } from '../../worker/src/auth/router';
let f: Awaited<ReturnType<typeof pollFixture>>;
let dispose: (() => Promise<void>) | undefined;
let directory: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  await dispose?.();
  dispose = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('runs the real CLI with an env file through HTTP and D1 from authoring to results', async () => {
  f = await pollFixture();
  dispose = f.dispose;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    // Preserve the HTTP body and headers. Cloudflare can expose an empty POST
    // as a non-null body; rebuilding parsed JSON hid production HTTP 415 errors.
    const headers = new Headers({ Authorization: req.headers.authorization ?? '' });
    if (req.headers['content-type'])
      headers.set('Content-Type', req.headers['content-type']);
    const response = await handleAuth(
      new Request(`${SITE}${req.url!}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' ? undefined : new Uint8Array(Buffer.concat(chunks)),
      }),
      f.env,
      f.deps,
      f.deps,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  directory = await mkdtemp(join(tmpdir(), 'poll-cli-'));
  const envFile = join(directory, '.env');
  await writeFile(
    envFile,
    `AINOOGA_API_TOKEN=${ORGANIZER_TOKEN}\nAINOOGA_API_URL=${url}\n`,
    { mode: 0o600 },
  );
  const pollFile = join(directory, 'poll.md');
  const source = (await readFile('docs/polls/topic-vote.md', 'utf8')).replace(
    '2026-10-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );
  await writeFile(pollFile, source);
  const votersFile = join(directory, 'voters.yml');
  await writeFile(votersFile, '- kind: email\n  value: voter@example.com\n');
  const cli = async (...args: string[]) => {
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/poll.ts', '--env-file', envFile, ...args],
      {
        env: { ...process.env, AINOOGA_API_TOKEN: undefined, AINOOGA_API_URL: undefined },
      },
    );
    expect(result.stdout + result.stderr).not.toContain(ORGANIZER_TOKEN);
    return JSON.parse(result.stdout);
  };
  expect(await cli('create', pollFile)).toMatchObject({ status: 'draft' });
  expect(await cli('allowlist', 'add', 'topic-vote', votersFile)).toEqual({
    processed: 1,
  });
  expect(await cli('show', 'topic-vote')).toMatchObject({
    eligibility: { eligibleCount: 1 },
  });
  expect(await cli('publish', 'topic-vote')).toMatchObject({ status: 'published' });
  const login = await f.request('/api/polls/topic-vote/auth/honor', 'POST', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  expect(
    (
      await f.request(
        '/api/polls/topic-vote/ballot',
        'PUT',
        submission([], 0, 'CLI integration'),
        { Cookie: cookie },
      )
    ).status,
  ).toBe(200);
  expect(await cli('results', 'topic-vote')).toMatchObject({ ballotCount: 1 });
  expect(await cli('ballots', 'topic-vote')).toMatchObject([
    { personId: 2, revision: 1 },
  ]);
  expect(await cli('archive', 'topic-vote')).toMatchObject({ status: 'archived' });
}, 15000);
it('refuses API redirects without forwarding the organizer credential', async () => {
  let calls = 0;
  server = createServer((_req, res) => {
    calls++;
    res.writeHead(302, { Location: '/redirected' });
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const api = new PollClient(
    ORGANIZER_TOKEN,
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  await expect(api.request('')).rejects.toThrow('redirects are refused');
  expect(calls).toBe(1);
});
