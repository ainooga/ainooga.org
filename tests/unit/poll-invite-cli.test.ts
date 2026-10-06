// @vitest-environment node
import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it.each([0, 1])(
  'prints the invitation summary and exits according to %i failures',
  async (failed) => {
    const directory = await mkdtemp(join(tmpdir(), 'poll-invite-cli-'));
    const envFile = join(directory, '.env');
    const provider = join(directory, 'api.mjs');
    const summary = { recipients: 2, accepted: 2 - failed, failed };
    try {
      await writeFile(
        envFile,
        `AINOOGA_API_TOKEN=${'a'.repeat(64)}\nAINOOGA_API_URL=https://ainooga.test\n`,
      );
      await writeFile(
        provider,
        `import assert from 'node:assert/strict';
      let requests = 0;
      globalThis.fetch = async (url, init) => {
        assert.equal(++requests, 1);
        assert.equal(String(url), 'https://ainooga.test/api/admin/polls/topics/invite');
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Authorization, 'Bearer ${'a'.repeat(64)}');
        assert.equal(init.body, '{}');
        return Response.json(${JSON.stringify(summary)});
      };`,
      );
      const result = await promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          provider,
          'scripts/poll.ts',
          '--env-file',
          envFile,
          'invite',
          'topics',
        ],
        {
          env: {
            ...process.env,
            AINOOGA_API_TOKEN: undefined,
            AINOOGA_API_URL: undefined,
          },
        },
      ).then(
        (output) => ({ ...output, code: 0 }),
        (error: { stdout: string; stderr: string; code: number }) => error,
      );
      expect(result.code).toBe(failed > 0 ? 1 : 0);
      expect(JSON.parse(result.stdout)).toEqual(summary);
      expect(result.stdout + result.stderr).not.toContain('a'.repeat(64));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
