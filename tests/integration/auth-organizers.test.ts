// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixture, ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
import worker from '../../worker/src/index';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});
const auth = { Authorization: `Bearer ${ORGANIZER_TOKEN}` };

describe('organizer API access', () => {
  it('accepts a configured token without Cloudflare credentials or permission grants', async () => {
    const response = await f.call('/api/admin/me', undefined, undefined, auth);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'organizer', personId: 1 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(
      await f.store.query(
        "SELECT * FROM sqlite_master WHERE name='organizer_permissions'",
      ),
    ).toEqual([]);
  });
  it('rejects missing, incorrect, and removed credentials', async () => {
    expect((await f.call('/api/admin/me')).status).toBe(401);
    expect(
      (
        await f.call('/api/admin/me', undefined, undefined, {
          Authorization: `Bearer ${'b'.repeat(64)}`,
        })
      ).status,
    ).toBe(401);
    f.env.ORGANIZER_API_TOKENS = JSON.stringify([
      { name: 'replacement', personId: 1, token: 'b'.repeat(64) },
    ]);
    expect((await f.call('/api/admin/me', undefined, undefined, auth)).status).toBe(401);
  });
  it('fails closed on bad configuration or missing organizer record', async () => {
    f.env.ORGANIZER_API_TOKENS = '{}';
    expect((await f.call('/api/admin/me', undefined, undefined, auth)).status).toBe(503);
    f.env.ORGANIZER_API_TOKENS = JSON.stringify([
      { name: 'missing', personId: 999, token: ORGANIZER_TOKEN },
    ]);
    expect((await f.call('/api/admin/me', undefined, undefined, auth)).status).toBe(503);
  });
  it('links identifiers idempotently and preserves ownership and verification', async () => {
    const route = '/api/admin/people/2/identifiers';
    const input = { kind: 'email', value: ' New@Example.com ' };
    const first = await f.call(route, input, undefined, auth);
    expect(first.status).toBe(200);
    expect(await (await f.call(route, input, undefined, auth)).json()).toEqual(
      await first.json(),
    );
    expect(
      (await f.call('/api/admin/people/3/identifiers', input, undefined, auth)).status,
    ).toBe(409);
    expect(
      await f.store.query(
        "SELECT person_id,verified_at FROM person_identifiers WHERE normalized_value='new@example.com'",
      ),
    ).toEqual([{ person_id: 2, verified_at: null }]);
    expect(
      (
        await f.call(
          route,
          { kind: 'email', value: 'other@example.com' },
          undefined,
          auth,
        )
      ).status,
    ).toBe(409);
    expect((await f.call(route, input)).status).toBe(401);
  });
  it('rejects unknown fields and unsupported identifiers', async () => {
    for (const body of [
      { kind: 'phone', value: '123' },
      { kind: 'email', value: 'new@example.com', verified_at: 'now' },
    ]) {
      expect(
        (await f.call('/api/admin/people/2/identifiers', body, undefined, auth)).status,
      ).toBe(400);
    }
  });
});

describe('request boundaries', () => {
  it('rejects cross-origin mutation, bad JSON, wrong content type, and oversized streams', async () => {
    const route = `${SITE}/api/admin/people/2/identifiers`;
    for (const [body, type, origin, status] of [
      ['{}', 'application/json', 'https://evil.test', 403],
      ['{', 'application/json', SITE, 400],
      ['{}', 'text/plain', SITE, 415],
      ['x'.repeat(17000), 'application/json', SITE, 413],
    ] as const) {
      const response = await handleAuth(
        new Request(route, {
          method: 'POST',
          headers: { ...auth, Origin: origin, 'Content-Type': type },
          body,
        }),
        f.env,
        f.deps,
        f.deps,
      );
      expect(response.status).toBe(status);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(await response.json()).toHaveProperty('requestId');
    }
  });
  it('gates new routes before touching dependencies and respects rate limits', async () => {
    f.env.AUTH_READY = undefined;
    expect(
      (await worker.fetch(new Request(`${SITE}/api/admin/me`), f.env, f.deps)).status,
    ).toBe(503);
    f.env.AUTH_READY = 'true';
    f.deps.allowed = false;
    const response = await f.call('/api/admin/me', undefined, undefined, auth);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});
