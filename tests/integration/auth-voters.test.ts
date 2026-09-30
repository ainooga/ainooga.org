// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authFixture,
  emailChallenge,
  verifiedLogin,
  responseCookie,
} from '../helpers/auth';
import { cleanupAuth } from '../../worker/src/auth/store';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});
const verifyPath = '/api/polls/verified/auth/email/verify';

describe('email verification', () => {
  it('verifies the exact email, stores only hashes, and issues a secure session', async () => {
    const challenge = await emailChallenge(f);
    expect(challenge.response.status).toBe(202);
    expect(f.deps.sent).toEqual([{ address: 'voter@example.com', code: '123456' }]);
    const response = await f.call(
      verifyPath,
      { challengeId: challenge.id, code: '123456' },
      challenge.browser,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(
      'HttpOnly; SameSite=Lax; Secure; Max-Age=86400',
    );
    expect(
      await f.store.query('SELECT id,verified_at FROM person_identifiers ORDER BY id'),
    ).toEqual([
      { id: 2, verified_at: f.deps.time.toISOString() },
      { id: 3, verified_at: null },
      { id: 4, verified_at: null },
    ]);
    const rows = await f.store.query(
      'SELECT proof_hash,browser_hash FROM auth_challenges',
    );
    expect(rows[0]!.proof_hash).not.toContain('123456');
    const sessions = await f.store.query('SELECT token_hash FROM voter_sessions');
    expect(responseCookie(response)).not.toContain(sessions[0]!.token_hash);
    expect(
      (
        await f.call(
          verifyPath,
          { challengeId: challenge.id, code: '123456' },
          challenge.browser,
        )
      ).status,
    ).toBe(400);
    expect(await f.store.query('SELECT * FROM subscriptions')).toEqual([]);
  });
  it('allows only one concurrent consumption', async () => {
    const challenge = await emailChallenge(f);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.call(
          verifyPath,
          { challengeId: challenge.id, code: '123456' },
          challenge.browser,
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400, 400, 400]);
    expect(await f.store.query('SELECT COUNT(*) AS n FROM voter_sessions')).toEqual([
      { n: 1 },
    ]);
  });
  it('caps concurrent failed attempts and rejects the right code afterward', async () => {
    const challenge = await emailChallenge(f);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.call(
          verifyPath,
          { challengeId: challenge.id, code: '000000' },
          challenge.browser,
        ),
      ),
    );
    expect(responses.every((r) => r.status === 400)).toBe(true);
    expect(await f.store.query('SELECT attempts FROM auth_challenges')).toEqual([
      { attempts: 5 },
    ]);
    expect(
      (
        await f.call(
          verifyPath,
          { challengeId: challenge.id, code: '123456' },
          challenge.browser,
        )
      ).status,
    ).toBe(400);
  });
  it('requires the initiating browser and expires at ten minutes', async () => {
    const challenge = await emailChallenge(f);
    const body = { challengeId: challenge.id, code: '123456' };
    expect((await f.call(verifyPath, body)).status).toBe(400);
    expect(
      (await f.call(verifyPath, body, `__Host-ainooga-challenge=${'f'.repeat(64)}`))
        .status,
    ).toBe(400);
    f.deps.time = new Date(f.deps.time.getTime() + 600000);
    expect((await f.call(verifyPath, body, challenge.browser)).status).toBe(400);
  });
  it('does not reveal unknown recipients and enforces a concurrent resend cooldown', async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => emailChallenge(f)),
    );
    expect(responses.every((r) => r.response.status === 202)).toBe(true);
    expect(f.deps.sent).toHaveLength(1);
    const response = await f.call('/api/polls/verified/auth/email/request', {
      email: 'unknown@example.com',
      turnstileToken: 'bot',
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toHaveProperty('challengeId');
    expect(f.deps.sent).toHaveLength(1);
    expect(await f.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([{ n: 3 }]);
  });
  it('limits requests to five per identity per hour', async () => {
    for (let i = 0; i < 6; i++) {
      await emailChallenge(f);
      f.deps.time = new Date(f.deps.time.getTime() + 61000);
    }
    expect(f.deps.sent).toHaveLength(5);
  });
  it('invalidates failed deliveries without exposing provider details', async () => {
    f.deps.sendFails = true;
    const challenge = await emailChallenge(f);
    expect(challenge.response.status).toBe(202);
    expect(
      (
        await f.call(
          verifyPath,
          { challengeId: challenge.id, code: '123456' },
          challenge.browser,
        )
      ).status,
    ).toBe(400);
    expect(
      await f.store.query('SELECT verified_at FROM person_identifiers WHERE id=2'),
    ).toEqual([{ verified_at: null }]);
  });
  it('rejects bot failures and revoked eligibility before verifying', async () => {
    f.deps.botValid = false;
    expect(
      (
        await f.call('/api/polls/verified/auth/email/request', {
          email: 'voter@example.com',
          turnstileToken: 'bad',
        })
      ).status,
    ).toBe(400);
    f.deps.botValid = true;
    const c = await emailChallenge(f);
    await f.store.execute([
      "UPDATE poll_allowlist SET revoked_at = 'now' WHERE poll_id=2",
    ]);
    expect(
      (await f.call(verifyPath, { challengeId: c.id, code: '123456' }, c.browser)).status,
    ).toBe(400);
  });
});

describe('voter sessions', () => {
  it('reuses verified proof only across currently eligible polls', async () => {
    const cookie = responseCookie(await verifiedLogin(f));
    for (const slug of ['verified', 'honor']) {
      expect(
        await (await f.call(`/api/polls/${slug}/session`, undefined, cookie)).json(),
      ).toMatchObject({ authenticated: true, personId: 2, assurance: 'verified' });
    }
    expect(
      await (await f.call('/api/polls/other/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
    expect((await f.call('/api/admin/me', undefined, cookie)).status).toBe(401);
    await f.store.execute(["UPDATE poll_allowlist SET revoked_at='now' WHERE poll_id=2"]);
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
  });
  it('isolates honor assertions and never marks them verified', async () => {
    const input = {
      identifier: { kind: 'email', value: 'voter@example.com' },
      turnstileToken: 'bot',
    };
    const response = await f.call('/api/polls/honor/auth/honor', input);
    expect(response.status).toBe(200);
    const cookie = responseCookie(response);
    expect(
      await (await f.call('/api/polls/honor/session', undefined, cookie)).json(),
    ).toMatchObject({ authenticated: true, assurance: 'honor' });
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
    expect((await f.call('/api/polls/verified/auth/honor', input)).status).toBe(403);
    expect(
      await f.store.query('SELECT verified_at FROM person_identifiers WHERE id=2'),
    ).toEqual([{ verified_at: null }]);
  });
  it('expires after 24 hours even though the email remains verified', async () => {
    const cookie = responseCookie(await verifiedLogin(f));
    f.deps.time = new Date(f.deps.time.getTime() + 86400000);
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
    expect(
      await f.store.query('SELECT verified_at FROM person_identifiers WHERE id=2'),
    ).not.toEqual([{ verified_at: null }]);
  });
  it('invalidates sessions when the identifier value changes', async () => {
    const cookie = responseCookie(await verifiedLogin(f));
    await f.store.execute([
      "UPDATE person_identifiers SET normalized_value='changed@example.com',value='changed@example.com',verified_at=NULL WHERE id=2",
    ]);
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
  });
  it('logs out server-side and cleans expired records', async () => {
    const cookie = responseCookie(await verifiedLogin(f));
    expect((await f.call('/api/auth/logout', {}, cookie)).status).toBe(200);
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
    await cleanupAuth(f.db, new Date(f.deps.time.getTime() + 3 * 86400000));
    expect(await f.store.query('SELECT * FROM auth_challenges')).toEqual([]);
  });
});
