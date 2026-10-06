// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { memberFixture, memberInput } from '../helpers/members';
import { ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
import { MemberClient } from '../../scripts/members/client';
let f: Awaited<ReturnType<typeof memberFixture>>;
let directory: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  await dispose?.();
  dispose = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('runs the real CLI through preview, a lost committed response, and safe recovery', async () => {
  f = await memberFixture();
  dispose = f.dispose;
  let writes = 0;
  let requests = 0;
  const modes: string[] = [];
  server = createServer(async (req, res) => {
    requests++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const preview = req.url!.endsWith('/preview');
    modes.push(preview ? 'preview' : 'import');
    const response = await handleAuth(
      new Request(`${SITE}${req.url!}`, {
        method: req.method,
        headers: {
          Authorization: req.headers.authorization ?? '',
          'Content-Type': req.headers['content-type'] ?? '',
        },
        body: new Uint8Array(Buffer.concat(chunks)),
      }),
      f.env,
      f.deps,
      f.deps,
    );
    if (!preview && ++writes === 2) {
      req.socket.destroy();
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  directory = await mkdtemp(join(tmpdir(), 'member-cli-'));
  const envFile = join(directory, '.env');
  await writeFile(
    envFile,
    `AINOOGA_API_TOKEN=${ORGANIZER_TOKEN}\nAINOOGA_API_URL=http://127.0.0.1:${(server.address() as AddressInfo).port}\n`,
    { mode: 0o600 },
  );
  const path = join(directory, 'members.json');
  const records = [
    memberInput(),
    { ...memberInput(), sourceKey: 'second', email: 'second@example.com' },
  ];
  await writeFile(path, JSON.stringify(records));
  const run = async (command: string, file = path) =>
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/members.ts', '--env-file', envFile, command, file],
      {
        env: { ...process.env, AINOOGA_API_TOKEN: undefined, AINOOGA_API_URL: undefined },
      },
    );
  expect(JSON.parse((await run('validate')).stdout)).toMatchObject({
    members: 2,
    events: 1,
    registrations: 2,
  });
  expect(requests).toBe(0);
  const preview = JSON.parse((await run('preview')).stdout);
  expect(preview.changes.create).toBe(19);
  expect(await f.store.query("SELECT * FROM person_tags WHERE tag='member'")).toEqual([]);
  await expect(run('import')).rejects.toMatchObject({
    stderr: expect.stringContaining('after 1 confirmed members'),
  });
  expect(modes).toEqual(['preview', 'preview', 'preview', 'preview', 'import', 'import']);
  expect(
    await f.store.query("SELECT count(*) AS n FROM person_tags WHERE tag='member'"),
  ).toEqual([{ n: 2 }]);
  const retried = await run('import');
  expect(JSON.parse(retried.stdout)).toMatchObject({
    changes: { create: 0, fill: 0 },
    conflicts: 0,
  });
  for (const privateValue of [ORGANIZER_TOKEN, records[0]!.email, records[1]!.email])
    expect(retried.stdout + retried.stderr).not.toContain(privateValue);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 5 }]);
  expect(await f.store.query('SELECT count(*) AS n FROM events')).toEqual([{ n: 1 }]);
  const invalid = join(directory, 'invalid.json');
  await writeFile(
    invalid,
    JSON.stringify([records[0], { ...records[1], email: 'invalid' }]),
  );
  const count = requests;
  await expect(run('import', invalid)).rejects.toMatchObject({
    stderr: expect.stringContaining('1.email'),
  });
  expect(requests).toBe(count);
}, 20000);

it('refuses redirects and redacts server errors and malformed responses', async () => {
  let calls = 0;
  server = createServer((_req, res) => {
    calls++;
    if (calls === 1) {
      res.writeHead(302, { Location: '/redirected' });
      res.end();
    } else if (calls === 2) {
      res.writeHead(409);
      res.end('private@example.com');
    } else res.end('{"private":"private@example.com"}');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const client = new MemberClient(
    ORGANIZER_TOKEN,
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  await expect(client.request(memberInput(), false)).rejects.toThrow(
    'redirects are refused',
  );
  expect(calls).toBe(1);
  await expect(client.request(memberInput(), true)).rejects.toThrow('HTTP 409');
  await expect(client.request(memberInput(), true)).rejects.toThrow(
    'Invalid import API response',
  );
});
