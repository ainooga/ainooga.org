// @vitest-environment node
import { expect, it } from 'vitest';
import { AicTransport } from '../../worker/src/member-sync/source';
import {
  SessionCookies,
  exportedSessionCookies,
} from '../../worker/src/member-sync/session';
import { encryptSession, decryptSession } from '../../worker/src/member-sync/session';
import { AicSource } from '../../worker/src/member-sync/source';

const name = '__Secure-authjs.session-token';
function fixture(responses: (Response | Error)[]) {
  const calls: Request[] = [],
    delays: number[] = [],
    saved: string[] = [];
  const cookies = new SessionCookies({ [name]: 'synthetic-session' });
  const transport = new AicTransport({
    cookies,
    now: () => Date.parse('2026-10-10T00:00:00Z'),
    fetch: async (req) => {
      calls.push(req);
      const response = responses.shift()!;
      if (response instanceof Error) throw response;
      return response;
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    save: async (jar) => {
      saved.push(jar.serialize());
    },
  });
  return { transport, calls, delays, saved, cookies };
}
const batch = (data: unknown[]) =>
  Response.json(data.map((json) => ({ result: { data: { json } } })));

it('retries transient failures, obeys retry delays, retains rotation, and refuses redirects', async () => {
  const f = fixture([
    new Error('Secret network detail'),
    new Response('private', { status: 429, headers: { 'Retry-After': '2' } }),
    Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': `${name}=rotated; Path=/; Secure; HttpOnly` } },
    ),
  ]);
  expect(await f.transport.request('/api/auth/session')).toEqual({ ok: true });
  expect(f.delays).toEqual([1000, 2000]);
  expect(f.calls.every((r) => r.redirect === 'manual')).toBe(true);
  expect(f.saved).toEqual([JSON.stringify({ [name]: 'rotated' })]);
  const redirect = fixture([
    new Response(null, { status: 302, headers: { Location: 'https://other.invalid' } }),
  ]);
  await expect(redirect.transport.request('/api/auth/session')).rejects.toThrow(
    'source_http_error',
  );
  expect(redirect.calls).toHaveLength(1);
});

it.each([401, 403, 500, 429])(
  'redacts unsuccessful HTTP %s responses and bounds attempts',
  async (status) => {
    const f = fixture(
      Array.from(
        { length: 3 },
        () => new Response('Private secret response', { status }),
      ),
    );
    const error = await f.transport.request('/api/auth/session').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('Private');
    expect(f.calls).toHaveLength(status < 429 ? 1 : 3);
  },
);

it('does not retry earlier than a long Retry-After or expose embedded tRPC errors', async () => {
  const f = fixture([
    new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
  ]);
  await expect(f.transport.request('/api/auth/session')).rejects.toThrow(
    'source_retry_later',
  );
  expect(f.calls).toHaveLength(1);
  const embedded = fixture([Response.json([{ error: { message: 'Private values' } }])]);
  await expect(embedded.transport.batch('GET', ['members.get'], [{}])).rejects.toThrow(
    'source_invalid',
  );
});

it('encodes the chapter-scoped roster contract and verifies chapter access and counts', async () => {
  const f = fixture([
    batch([{ chapterIds: ['chattanooga'] }, [{ id: 'chattanooga', numMembers: 1 }]]),
    batch([
      {
        members: [
          { email: 'MEMBER@example.com', allChapterIds: ['other', 'chattanooga'] },
        ],
        nextCursor: null,
      },
    ]),
  ]);
  expect(await new AicSource(f.transport).roster()).toEqual(['member@example.com']);
  const requestBody = await f.calls[1]!.json();
  expect(requestBody).toMatchObject({
    '0': { json: { chapterId: 'chattanooga', limit: 1000 } },
  });
  expect(JSON.stringify(requestBody).includes('cursor')).toBe(false);
});

it('rejects chapter access failures before requesting any roster', async () => {
  const f = fixture([batch([{ chapterIds: ['other'] }, []])]);
  await expect(new AicSource(f.transport).roster()).rejects.toThrow(
    'chapter_access_denied',
  );
  expect(f.calls).toHaveLength(1);
});

it('encrypts only AIC session cookies and authenticates ciphertext', async () => {
  const cookies = exportedSessionCookies([
    {
      name,
      value: 'synthetic-session',
      domain: '.platform.aicollective.com',
      path: '/',
      secure: true,
    },
    {
      name: 'google-secret',
      value: 'excluded',
      domain: 'accounts.google.com',
      path: '/',
      secure: true,
    },
  ]);
  const secret = 'a'.repeat(64);
  const encrypted = await encryptSession(cookies, secret);
  expect(encrypted).not.toContain('synthetic-session');
  expect((await decryptSession(encrypted, secret)).header()).toBe(
    `${name}=synthetic-session`,
  );
  await expect(decryptSession(encrypted, 'b'.repeat(64))).rejects.toThrow(
    'session_invalid',
  );
  await expect(encryptSession(cookies, 'bad-key')).rejects.toThrow('session_key_invalid');
  expect(cookies.header()).not.toContain('google');
});

it('handles chunked cookie rotation and deletions without retaining obsolete chunks', () => {
  const cookies = new SessionCookies({ [name]: 'old' });
  const headers = new Headers();
  headers.append('Set-Cookie', `${name}=; Max-Age=0; Path=/`);
  headers.append('Set-Cookie', `${name}.0=new0; Secure`);
  headers.append('Set-Cookie', `${name}.1=new1; Secure`);
  cookies.update(headers, Date.now());
  expect(cookies.header()).toBe(`${name}.0=new0; ${name}.1=new1`);
});

it('rejects missing, expired, or malformed exported sessions', () => {
  const cookie = {
    name,
    value: 'secret',
    domain: 'platform.aicollective.com',
    path: '/',
    secure: true,
  };
  for (const value of [
    null,
    [],
    [{ ...cookie, value: 4 }],
    [{ ...cookie, expirationDate: 1 }],
    [{ ...cookie, domain: 'accounts.google.com' }],
  ])
    expect(() => exportedSessionCookies(value, Date.now())).toThrow('session_invalid');
});
