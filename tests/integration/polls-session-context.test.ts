// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserPollService } from '../../src/lib/polls/api';
import { PollError } from '../../src/lib/polls/types';
import { handleAuth } from '../../worker/src/auth/router';
import { pollFixture, pollInput, submission } from '../helpers/polls';
import { responseCookie, SITE, verifiedLogin } from '../helpers/auth';
import { fileDatabase } from '../helpers/file-database';

const open = fileDatabase();
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  vi.unstubAllGlobals();
  await f?.dispose();
});
// In-process transport: supply the current cookie, not a manufactured response.
function voterClient(cookie: string) {
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
    const request = new Request(new URL(path, SITE), init);
    request.headers.set('Origin', SITE);
    request.headers.set('Cookie', cookie);
    return handleAuth(request, f.env, f.deps, f.deps);
  });
  return new BrowserPollService();
}
async function detail(cookie: string, slug = 'topics') {
  const response = await f.request(`/api/polls/${slug}`, 'GET', undefined, {
    Cookie: cookie,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    sessionContext: string;
    voter: { kind: string; value: string };
  };
}
async function login(email: string) {
  return responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: email },
      turnstileToken: 'bot',
    }),
  );
}
it('binds a draft to its session and rejects a replacement identity without writes', async () => {
  f = await pollFixture(open);
  const first = await f.ready();
  const original = await detail(first);
  expect(original.sessionContext).toMatch(/^[a-f0-9]{64}$/);
  expect(original.voter).toEqual({ kind: 'email', value: 'voter@example.com' });
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'other@example.com' }],
  });
  const second = await login('other@example.com');
  const api = voterClient(second);
  const current = await api.detail('topics');
  expect(current.sessionContext).not.toBe(original.sessionContext);
  const input = {
    requestId: crypto.randomUUID(),
    sessionContext: original.sessionContext,
    expectedRevision: 0,
    optionIds: [],
    writeIn: 'Draft',
  };
  const rejected = api.submit('topics', input);
  await expect(rejected).rejects.toBeInstanceOf(PollError);
  await expect(rejected).rejects.toMatchObject({ status: 409, code: 'session_changed' });
  for (const table of ['poll_ballots', 'poll_ballot_choices'])
    expect(await f.store.query(`SELECT * FROM ${table}`)).toEqual([]);
  expect(
    await f.store.query("SELECT * FROM poll_options WHERE origin='write_in'"),
  ).toEqual([]);
  const accepted = await api.submit('topics', {
    ...input,
    sessionContext: current.sessionContext,
  });
  expect(accepted).toMatchObject({ revision: 1, optionIds: [expect.any(Number)] });
  expect((await api.detail('topics')).ballot).toEqual(accepted);
  expect(await f.store.query('SELECT person_id FROM poll_ballots')).toEqual([
    { person_id: 3 },
  ]);
});
it('requires a well-formed marker and never accepts it as a cookie credential', async () => {
  f = await pollFixture(open);
  const cookie = await f.ready();
  const current = await detail(cookie);
  for (const sessionContext of [undefined, 'bad', '0'.repeat(64)]) {
    const result = await f.request(
      '/api/polls/topics/ballot',
      'PUT',
      { ...submission('0'.repeat(64), [], 0, 'Choice'), sessionContext },
      { Cookie: cookie },
    );
    expect(result.status).toBe(sessionContext?.length === 64 ? 409 : 400);
  }
  const forged = cookie.split('=')[0] + '=' + current.sessionContext;
  expect(
    (await f.request('/api/polls/topics', 'GET', undefined, { Cookie: forged })).status,
  ).toBe(401);
});
it('changes the marker across polls and re-entry, with a stable marker for the same session', async () => {
  f = await pollFixture(open);
  const cookie = await f.ready();
  const original = await detail(cookie);
  expect((await detail(cookie)).sessionContext).toBe(original.sessionContext);
  const fresh = await login('voter@example.com');
  expect((await detail(fresh)).sessionContext).not.toBe(original.sessionContext);
  const other = await f.ready(pollInput({ slug: 'another' }));
  const next = await detail(other, 'another');
  expect(next.sessionContext).not.toBe(original.sessionContext);
  expect(
    (
      await f.request(
        '/api/polls/another/ballot',
        'PUT',
        {
          ...submission('0'.repeat(64), [], 0, 'X'),
          sessionContext: original.sessionContext,
        },
        { Cookie: other },
      )
    ).status,
  ).toBe(409);
});

it('scopes one verified session to each poll and exposes only its own identifier', async () => {
  f = await pollFixture(open);
  await f.ready();
  await f.ready(pollInput({ slug: 'another' }));
  const cookie = responseCookie(await verifiedLogin(f));
  const first = await detail(cookie);
  const second = await detail(cookie, 'another');
  expect(first.sessionContext).not.toBe(second.sessionContext);
  expect(first.voter).toEqual({ kind: 'email', value: 'voter@example.com' });
  const rejected = await f.request(
    '/api/polls/another/ballot',
    'PUT',
    submission(first.sessionContext, [], 0, 'Wrong poll'),
    { Cookie: cookie },
  );
  expect(await rejected.json()).toMatchObject({ code: 'session_changed' });
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual([]);
});
it('returns a Discord username or its numeric fallback without exposing a linked email', async () => {
  f = await pollFixture(open);
  await f.ready();
  await f.db
    .prepare(
      "UPDATE person_identifiers SET display_label='chapter.user' WHERE kind='discord'",
    )
    .run();
  const login = await f.request('/api/polls/topics/auth/honor', 'POST', {
    identifier: { kind: 'discord_username', value: 'chapter.user' },
    turnstileToken: 'bot',
  });
  const cookie = responseCookie(login);
  expect((await detail(cookie)).voter).toEqual({
    kind: 'discord',
    value: 'chapter.user',
  });
  await f.db
    .prepare("UPDATE person_identifiers SET display_label=NULL WHERE kind='discord'")
    .run();
  expect((await detail(cookie)).voter).toEqual({
    kind: 'discord',
    value: '123456789012345678',
  });
});
