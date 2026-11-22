// @vitest-environment node
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberFixture, memberInput } from '../helpers/members';
import { ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
import { cliStartup, close, listen } from '../cli/cli-startup';

it('recovers when D1 commits the second import but the CLI never receives its reply', async () => {
  const f = await memberFixture();
  const calls: [string, number][] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
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
    calls.push([req.url!, response.status]);
    if (calls.length === 4) {
      req.socket.destroy();
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  const directory = await mkdtemp(join(tmpdir(), 'member-cli-'));
  try {
    const origin = await listen(server);
    const path = join(directory, 'members.json');
    const first = {
      ...memberInput(),
      company: null,
      professionalRole: null,
      phone: null,
      linkedin: null,
      tags: [],
      participations: [],
    };
    const records = [
      first,
      { ...first, sourceKey: 'second', email: 'second@example.com' },
    ];
    await writeFile(path, JSON.stringify(records));
    const run = () =>
      cliStartup('members', directory, origin, ORGANIZER_TOKEN, [
        'import',
        'members.json',
      ]);
    const failure = await run().catch(
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    expect(failure).toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining(
        'after 1 confirmed members. Row 2 may have committed.',
      ),
    });
    const route = '/api/admin/members/import';
    const expected = [`${route}/preview`, `${route}/preview`, route, route].map(
      (path) => [path, 200],
    );
    expect(calls).toEqual(expected);
    const count = () =>
      f.store.query("SELECT count(*) AS n FROM person_tags WHERE tag='member'");
    expect(await count()).toEqual([{ n: 2 }]);
    const retried = await run();
    expect(JSON.parse(retried.stdout)).toMatchObject({
      changes: { create: 0, fill: 0 },
      conflicts: 0,
    });
    expect(retried.stderr).toBe('');
    expect(calls).toEqual([...expected, ...expected]);
    expect(await count()).toEqual([{ n: 2 }]);
    for (const value of [ORGANIZER_TOKEN, ...records.map((record) => record.email)])
      expect(failure.stderr + retried.stdout).not.toContain(value);
  } finally {
    await close(server);
    await f.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
