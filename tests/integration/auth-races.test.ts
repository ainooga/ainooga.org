// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixture, emailChallenge, responseCookie } from '../helpers/auth';
import { deferred, pauseBatch } from '../helpers/background';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});

async function attempt(kind: 'email' | 'discord') {
  if (kind === 'email') {
    const c = await emailChallenge(f);
    return {
      browser: c.browser,
      finish: () =>
        f.call(
          '/api/polls/verified/auth/email/verify',
          { challengeId: c.id, code: '123456' },
          c.browser,
        ),
    };
  }
  const response = await f.call('/api/polls/verified/auth/discord/start', {
    turnstileToken: 'bot',
  });
  const { url } = (await response.json()) as { url: string };
  const browser = responseCookie(response);
  const path = `/api/auth/discord/callback?code=test&state=${new URL(url).searchParams.get('state')}`;
  return { browser, finish: () => f.call(path, undefined, browser) };
}

async function expectLoggedOut(response: Response) {
  const cookie = response.headers.has('set-cookie')
    ? responseCookie(response)
    : undefined;
  expect(
    await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
  ).toEqual({ authenticated: false });
  expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual([]);
}

describe('logout and authentication races', () => {
  it.each(['email', 'discord'] as const)(
    'cancels %s before issuance commits',
    async (kind) => {
      const login = await attempt(kind);
      const gate = pauseBatch(f.db, 'before');
      f.deps.db = gate.db;
      const pending = login.finish();
      await gate.reached;
      try {
        expect((await f.call('/api/auth/logout', {}, login.browser)).status).toBe(200);
      } finally {
        gate.release();
      }
      const response = await pending;
      expect(response.status).toBe(400);
      expect(response.headers.has('set-cookie')).toBe(false);
      await expectLoggedOut(response);
      expect(
        await f.store.query(
          'SELECT verified_at FROM person_identifiers WHERE id IN (2,4)',
        ),
      ).toEqual([{ verified_at: null }, { verified_at: null }]);
    },
  );

  it.each(['email', 'discord'] as const)(
    'revokes %s committed before its cookie arrives',
    async (kind) => {
      const login = await attempt(kind);
      const gate = pauseBatch(f.db, 'after');
      f.deps.db = gate.db;
      const pending = login.finish();
      await gate.reached;
      try {
        expect(await f.store.query('SELECT COUNT(*) AS n FROM voter_sessions')).toEqual([
          { n: 1 },
        ]);
        expect((await f.call('/api/auth/logout', {}, login.browser)).status).toBe(200);
      } finally {
        gate.release();
      }
      const response = await pending;
      expect(response.status).toBe(kind === 'email' ? 200 : 303);
      await expectLoggedOut(response);
      expect((await login.finish()).status).toBe(400);
    },
  );

  it('cancels Discord while the provider is pending', async () => {
    const login = await attempt('discord');
    f.deps.discordGate = deferred();
    const pending = login.finish();
    await f.deps.discordStarted.promise;
    try {
      expect((await f.call('/api/auth/logout', {}, login.browser)).status).toBe(200);
    } finally {
      f.deps.discordGate.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(400);
    await expectLoggedOut(response);
  });

  it('rechecks expiry after the Discord exchange', async () => {
    const login = await attempt('discord');
    f.deps.discordGate = deferred();
    const pending = login.finish();
    await f.deps.discordStarted.promise;
    f.deps.time = new Date(f.deps.time.getTime() + 600000);
    f.deps.discordGate.resolve();
    expect((await pending).status).toBe(400);
    expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual([]);
  });

  it.each([
    "UPDATE polls SET allowed_person_ids='[]' WHERE id=2",
    "UPDATE polls SET status='draft' WHERE id=2",
    'UPDATE person_identifiers SET person_id=3 WHERE id=4',
    "UPDATE person_identifiers SET normalized_value='999999999999999999' WHERE id=4",
    "UPDATE auth_challenges SET browser_hash='changed'",
  ])('rechecks eligibility and binding in the issuance transaction: %s', async (sql) => {
    const login = await attempt('discord');
    const gate = pauseBatch(f.db, 'before');
    f.deps.db = gate.db;
    const pending = login.finish();
    await gate.reached;
    try {
      await f.store.execute([sql]);
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(400);
    expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual([]);
    expect(
      await f.store.query('SELECT verified_at FROM person_identifiers WHERE id=4'),
    ).toEqual([{ verified_at: null }]);
  });

  it('does not revoke another browser logging in as the same person', async () => {
    const first = await attempt('discord');
    const second = await attempt('discord');
    const response = await second.finish();
    await f.call('/api/auth/logout', {}, first.browser);
    expect(
      await (
        await f.call('/api/polls/verified/session', undefined, responseCookie(response))
      ).json(),
    ).toMatchObject({ authenticated: true, personId: 2 });
    expect((await first.finish()).status).toBe(400);
  });
});
