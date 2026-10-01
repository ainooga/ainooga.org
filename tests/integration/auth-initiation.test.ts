// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixture, ORGANIZER_TOKEN } from '../helpers/auth';
import { authDependencies } from '../../worker/src/auth/providers';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});

class WindowLimiter {
  private counts = new Map<string, number>();
  constructor(
    private now: () => Date,
    private maximum: number,
  ) {}
  async limit({ key }: { key: string }) {
    const windowKey = `${key}:${Math.floor(this.now().getTime() / 60000)}`;
    const count = (this.counts.get(windowKey) ?? 0) + 1;
    this.counts.set(windowKey, count);
    return { success: count <= this.maximum };
  }
}

const routes = [
  ['/api/polls/verified/auth/discord/start', { turnstileToken: 'bot' }],
  [
    '/api/polls/verified/auth/email/request',
    { email: 'voter@example.com', turnstileToken: 'bot' },
  ],
  [
    '/api/polls/honor/auth/honor',
    { identifier: { kind: 'email', value: 'voter@example.com' }, turnstileToken: 'bot' },
  ],
] as const;

describe('anonymous issuance throttle', () => {
  it.each(routes)('rejects %s before providers or writes', async (path, body) => {
    f.deps.initiationAllowed = false;
    const response = await f.call(path, body);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(f.deps.botChecks).toBe(0);
    expect(f.deps.sent).toEqual([]);
    expect(await f.store.query('SELECT * FROM auth_challenges')).toEqual([]);
    expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual([]);
  });

  it('shares a counter across methods and polls, isolates IPs, and resets next minute', async () => {
    f.env.AUTH_INITIATION_RATE_LIMITER = new WindowLimiter(() => f.deps.now(), 2);
    f.deps.limitInitiation = authDependencies(f.env, f.deps).limitInitiation;
    expect((await f.call(...routes[0])).status).toBe(200);
    expect((await f.call(...routes[1])).status).toBe(202);
    expect((await f.call(...routes[2])).status).toBe(429);
    expect(
      (await f.call('/api/polls/other/auth/discord/start', { turnstileToken: 'bot' }))
        .status,
    ).toBe(429);
    expect(
      (await f.call(...routes[0], undefined, { 'CF-Connecting-IP': '192.0.2.1' })).status,
    ).toBe(200);
    f.deps.time = new Date(f.deps.time.getTime() + 60000);
    expect((await f.call(...routes[0])).status).toBe(200);
  });

  it('keeps logout, session reads and organizer access independent of the issuance throttle', async () => {
    f.deps.initiationAllowed = false;
    expect((await f.call('/api/auth/logout', {})).status).toBe(200);
    expect((await f.call('/api/polls/verified/session')).status).toBe(200);
    expect(
      (
        await f.call('/api/admin/me', undefined, undefined, {
          Authorization: `Bearer ${ORGANIZER_TOKEN}`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.call('/api/polls/verified/auth/email/verify', {
          challengeId: 'a'.repeat(64),
          code: '123456',
        })
      ).status,
    ).toBe(400);
    expect(f.deps.initiationKeys).toEqual([]);
  });

  it('fails closed without the binding before creating a challenge', async () => {
    f.deps.limitInitiation = authDependencies(f.env, f.deps).limitInitiation;
    expect((await f.call(...routes[0])).status).toBe(503);
    expect(f.deps.botChecks).toBe(0);
    expect(await f.store.query('SELECT * FROM auth_challenges')).toEqual([]);
  });
});
