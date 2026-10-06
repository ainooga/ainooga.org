// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberInput } from '../helpers/members';
import { MemberClient } from '../../scripts/members/client';
import { runMemberCommand } from '../../scripts/members/commands';

const token = 'a'.repeat(64);
const origin = 'https://api.example.com';
const success = () => Response.json({ actions: [], conflicts: [] });
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'member-errors-'));
  path = join(directory, 'members.json');
  await writeFile(
    path,
    JSON.stringify([
      memberInput(),
      { ...memberInput(), email: 'second@example.com', sourceKey: 'second' },
    ]),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it.each([
  ['', origin, 'AINOOGA_API_TOKEN'],
  ['invalid-private-token', origin, 'AINOOGA_API_TOKEN'],
  [token, '', 'AINOOGA_API_URL'],
  [token, 'http://example.com', 'Use HTTPS'],
  [token, 'https://private:password@example.com/path', 'without credentials'],
])(
  'explains configuration failure without echoing values',
  async (credential, url, reason) => {
    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests++;
      return success();
    });
    const api = {
      request: (input: ReturnType<typeof memberInput>, preview: boolean) =>
        new MemberClient(credential, url).request(input, preview),
    };
    const error = await runMemberCommand(['preview', path], api).catch(
      (error: Error) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Preview failed at row 1. No import writes were sent.',
    );
    expect((error as Error).message).toContain(reason);
    for (const value of [
      token,
      'invalid-private-token',
      'password',
      'member@example.com',
    ])
      expect((error as Error).message).not.toContain(value);
    expect(requests).toBe(0);
    expect(await runMemberCommand(['validate', path], api)).toMatchObject({
      mode: 'validate',
      members: 2,
    });
  },
);

it.each([401, 429, 503])(
  'retains HTTP %s through preview and partial import failures',
  async (status) => {
    const client = new MemberClient(token, origin);
    let requests = 0;
    let failAt = 1;
    vi.stubGlobal('fetch', async () => {
      requests++;
      return requests === failAt
        ? new Response(`private@example.com ${token}`, {
            status,
            statusText: 'private@example.com',
          })
        : success();
    });
    const preview = await runMemberCommand(['preview', path], client).catch(
      (error: Error) => error,
    );
    expect((preview as Error).message).toBe(
      `Preview failed at row 1. No import writes were sent. API request failed (HTTP ${status}).`,
    );
    expect(requests).toBe(1);
    requests = 0;
    failAt = 4;
    const error = await runMemberCommand(['import', path], client).catch(
      (error: Error) => error,
    );
    expect((error as Error).message).toContain(
      'after 1 confirmed members. Row 2 may have committed.',
    );
    expect((error as Error).message).toContain('Safely rerun the same file');
    expect((error as Error).message).toContain(`HTTP ${status}`);
    for (const value of ['private@example.com', token])
      expect((error as Error).message).not.toContain(value);
    expect(requests).toBe(4);
  },
);

it.each(['network', 'response'] as const)(
  'explains %s failures without disclosing private diagnostics',
  async (failure) => {
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network') throw new Error(`private@example.com ${token}`);
      return Response.json({ private: `private@example.com ${token}` });
    });
    const error = await runMemberCommand(
      ['preview', path],
      new MemberClient(token, origin),
    ).catch((error: Error) => error);
    expect((error as Error).message).toContain(
      failure === 'network'
        ? 'API request failed or timed out; redirects are refused.'
        : 'Invalid import API response.',
    );
    expect((error as Error).message).not.toContain('private@example.com');
    expect((error as Error).message).not.toContain(token);
  },
);

it.each(['preview', 'import'])(
  'redacts unexpected errors during %s even with a trusted-looking name',
  async (mode) => {
    const api = {
      async request(_input: unknown, preview: boolean) {
        if (mode === 'import' && preview) return { actions: [], conflicts: [] };
        const error = new Error(`private@example.com ${token}`);
        error.name = 'MemberClientError';
        throw error;
      },
    };
    const error = await runMemberCommand([mode, path], api).catch(
      (error: Error) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      mode === 'preview'
        ? 'Preview failed at row 1. No import writes were sent.'
        : 'Import stopped after 0 confirmed members. Row 1 may have committed.',
    );
    expect((error as Error).message).not.toContain('private@example.com');
    expect((error as Error).message).not.toContain(token);
  },
);
