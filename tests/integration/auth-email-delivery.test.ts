// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFixture, emailChallenge } from '../helpers/auth';
import { deferred } from '../helpers/background';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  vi.useRealTimers();
  await f.dispose();
});

const verify = (id: string, browser: string) =>
  f.call(
    '/api/polls/verified/auth/email/verify',
    { challengeId: id, code: '123456' },
    browser,
  );

describe('background verification email', () => {
  it('acknowledges eligible, unknown and throttled requests while delivery is pending', async () => {
    f.deps.sendGate = deferred();
    try {
      const eligible = await emailChallenge(f);
      const throttled = await emailChallenge(f);
      const unknown = await f.call('/api/polls/verified/auth/email/request', {
        email: 'unknown@example.com',
        turnstileToken: 'bot',
      });
      for (const response of [eligible.response, throttled.response, unknown]) {
        expect(response.status).toBe(202);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
      }
      expect(await unknown.json()).toEqual({
        challengeId: expect.any(String),
        message:
          'If eligible, you will receive a code. You can request another after one minute.',
      });
      expect(f.deps.sent).toHaveLength(1);
    } finally {
      f.deps.sendGate.resolve();
    }
    await f.deps.drain();
  });

  it('invalidates the challenge after a background rejection', async () => {
    f.deps.sendGate = deferred();
    const c = await emailChallenge(f);
    f.deps.sendGate.reject(new Error('private email provider details'));
    await f.deps.drain();
    expect((await verify(c.id, c.browser)).status).toBe(400);
    expect(await f.store.query('SELECT consumed_by FROM auth_challenges')).toEqual([
      { consumed_by: 'delivery_failed' },
    ]);
  });

  it('handles a database failure during background invalidation', async () => {
    f.deps.sendGate = deferred();
    await emailChallenge(f);
    await f.store.execute(['DROP TABLE auth_challenges']);
    f.deps.sendGate.reject(new Error('private provider error'));
    await expect(f.deps.drain()).resolves.toBeUndefined();
  });

  it('invalidates after ten seconds and ignores late provider completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.deps.sendGate = deferred();
    const c = await emailChallenge(f);
    await vi.advanceTimersByTimeAsync(10000);
    await f.deps.drain();
    f.deps.sendGate.resolve();
    expect((await verify(c.id, c.browser)).status).toBe(400);
    expect(await f.store.query('SELECT consumed_by FROM auth_challenges')).toEqual([
      { consumed_by: 'delivery_failed' },
    ]);
  });

  it.each(['verified', 'logout'] as const)(
    'preserves the %s marker when delivery later fails',
    async (state) => {
      f.deps.sendGate = deferred();
      const c = await emailChallenge(f);
      if (state === 'verified') expect((await verify(c.id, c.browser)).status).toBe(200);
      else await f.call('/api/auth/logout', {}, c.browser);
      const before = await f.store.query('SELECT consumed_by FROM auth_challenges');
      f.deps.sendGate.reject(new Error('private provider error'));
      await f.deps.drain();
      expect(await f.store.query('SELECT consumed_by FROM auth_challenges')).toEqual(
        before,
      );
      await f.call('/api/auth/logout', {}, c.browser);
      expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual([]);
    },
  );
});
