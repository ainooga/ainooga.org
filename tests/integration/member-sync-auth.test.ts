// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { claim } from '../../worker/src/member-sync/state';
import { authenticatedSource } from '../../worker/src/member-sync/session';
import { SessionCookies } from '../../worker/src/member-sync/session';
import { decryptSession, encryptSession } from '../../worker/src/member-sync/session';
import type { SyncEnvType } from '../../worker/src/member-sync/session';

let f: Awaited<ReturnType<typeof authFixture>>;
afterEach(async () => {
  await f?.dispose();
});
const cookieName = '__Secure-authjs.session-token';
const env = {
  AIC_BOT_EMAIL: 'bot@example.com',
  AIC_SESSION_KEY: 'a'.repeat(64),
} as SyncEnvType;

it('uses an imported session, saves rotation, and stops when the session is revoked', async () => {
  f = await authFixture();
  const lease = (await claim(f.db, () => Date.parse('2026-10-10T12:00:00Z')))!;
  await f.db
    .prepare('UPDATE member_sync_state SET session_ciphertext=?')
    .bind(
      await encryptSession(
        new SessionCookies({ [cookieName]: 'first' }),
        env.AIC_SESSION_KEY,
      ),
    )
    .run();
  let validToken = 'first',
    calls = 0;
  const deps = {
    sleep: async () => {},
    fetch: async (request: Request) => {
      calls++;
      const valid = request.headers.get('Cookie') === `${cookieName}=${validToken}`;
      if (!valid) return Response.json(null);
      validToken = `rotated${calls}`;
      return Response.json(
        { user: { email: env.AIC_BOT_EMAIL }, expires: '2027-01-01T00:00:00.000Z' },
        {
          headers: {
            'Set-Cookie': `${cookieName}=${validToken}; Secure; HttpOnly; Path=/`,
          },
        },
      );
    },
  };
  await authenticatedSource(lease, env, deps);
  expect(calls).toBe(1);
  const ciphertext = String(
    (await f.store.query('SELECT session_ciphertext FROM member_sync_state'))[0]!
      .session_ciphertext,
  );
  expect(ciphertext).not.toContain(validToken);
  expect((await decryptSession(ciphertext, env.AIC_SESSION_KEY)).header()).toBe(
    `${cookieName}=${validToken}`,
  );
  await authenticatedSource(lease, env, deps);
  expect(calls).toBe(2);
  validToken = 'revoked-and-replaced';
  await expect(authenticatedSource(lease, env, deps)).rejects.toThrow(
    'authentication_required',
  );
  expect(calls).toBe(3);
});

it('rejects missing credentials and redacts transient source failures', async () => {
  f = await authFixture();
  const lease = (await claim(f.db, () => Date.parse('2026-10-10T12:00:00Z')))!;
  let calls = 0;
  const deps = {
    sleep: async () => {},
    fetch: async () => {
      calls++;
      return new Response(null, { status: 503 });
    },
  };
  await expect(authenticatedSource(lease, env, deps)).rejects.toThrow(
    'authentication_required',
  );
  expect(calls).toBe(0);
  await expect(
    authenticatedSource(lease, { ...env, AIC_SESSION_KEY: '' }, deps),
  ).rejects.toThrow('authentication_configuration_invalid');
  expect(
    (await f.store.query('SELECT session_ciphertext FROM member_sync_state'))[0]!
      .session_ciphertext,
  ).toBeNull();
  await f.db
    .prepare('UPDATE member_sync_state SET session_ciphertext=?')
    .bind(
      await encryptSession(
        new SessionCookies({ [cookieName]: 'first' }),
        env.AIC_SESSION_KEY,
      ),
    )
    .run();
  await expect(authenticatedSource(lease, env, deps)).rejects.toThrow(
    'source_unavailable',
  );
  expect(calls).toBe(3);
});

it('rejects an expired or wrong-account session before member requests', async () => {
  f = await authFixture();
  const lease = (await claim(f.db, () => Date.parse('2026-10-10T12:00:00Z')))!;
  await f.db
    .prepare('UPDATE member_sync_state SET session_ciphertext=?')
    .bind(
      await encryptSession(
        new SessionCookies({ [cookieName]: 'first' }),
        env.AIC_SESSION_KEY,
      ),
    )
    .run();
  for (const user of ['other@example.com', env.AIC_BOT_EMAIL]) {
    const deps = {
      sleep: async () => {},
      fetch: async () =>
        Response.json({
          user: { email: user },
          expires:
            user === env.AIC_BOT_EMAIL ? '2020-01-01T00:00:00Z' : '2027-01-01T00:00:00Z',
        }),
    };
    await expect(authenticatedSource(lease, env, deps)).rejects.toThrow(
      'authentication_required',
    );
  }
});
