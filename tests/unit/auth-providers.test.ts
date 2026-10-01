// @vitest-environment node
import { BackgroundTasks, deferred } from '../helpers/background';
import { describe, expect, it } from 'vitest';
import { authDependencies } from '../../worker/src/auth/providers';
import { randomCode, randomToken, codeHash } from '../../worker/src/auth/crypto';
import type { Env } from '../../worker/src/types';

class ProviderFake {
  calls: Request[] = [];
  responses: Response[] = [];
  fetch: typeof fetch = async (input, init) => {
    this.calls.push(new Request(input, init));
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected provider request');
    return response;
  };
}

function env(): Env {
  return {
    DB: undefined as unknown as D1Database,
    EMAIL: undefined as unknown as SendEmail,
    TURNSTILE_SECRET_KEY: 'bot-secret',
    SITE_URL: 'https://ainooga.test',
    DISCORD_CLIENT_ID: 'client',
    DISCORD_CLIENT_SECRET: 'private',
  };
}

describe('identity provider adapters', () => {
  it('requires the correct Turnstile hostname and action', async () => {
    const fake = new ProviderFake();
    fake.responses = [
      { success: true, hostname: 'ainooga.test', action: 'poll-auth' },
      { success: true, hostname: 'evil.test', action: 'poll-auth' },
      { success: true, hostname: 'ainooga.test', action: 'newsletter' },
      { success: false },
    ].map((body) => Response.json(body));
    const deps = authDependencies(env(), new BackgroundTasks(), fake.fetch);
    expect(await deps.verifyBot('token')).toBe(true);
    expect(await deps.verifyBot('token')).toBe(false);
    expect(await deps.verifyBot('token')).toBe(false);
    expect(await deps.verifyBot('token')).toBe(false);
    const sent = new URLSearchParams(await fake.calls[0]!.text());
    expect(sent.get('secret')).toBe('bot-secret');
    expect(sent.get('response')).toBe('token');
  });
  it('exchanges a code privately and reads only the stable Discord ID', async () => {
    const fake = new ProviderFake();
    fake.responses = [
      Response.json({ access_token: 'provider-token' }),
      Response.json({
        id: '123456789012345678',
        username: 'Display name',
        email: 'untrusted@example.com',
      }),
    ];
    expect(
      await authDependencies(env(), new BackgroundTasks(), fake.fetch).discordIdentity(
        'code',
      ),
    ).toBe('123456789012345678');
    expect(fake.calls[0]!.headers.get('Content-Type')).toContain(
      'application/x-www-form-urlencoded',
    );
    const sent = new URLSearchParams(await fake.calls[0]!.text());
    expect(sent.get('redirect_uri')).toBe(
      'https://ainooga.test/api/auth/discord/callback',
    );
    expect(sent.get('client_secret')).toBe('private');
    expect(fake.calls[1]!.headers.get('Authorization')).toBe('Bearer provider-token');
  });
  it('fails closed on unavailable providers and missing bindings', async () => {
    const fake = new ProviderFake();
    fake.responses = [new Response('private failure', { status: 503 })];
    const deps = authDependencies(env(), new BackgroundTasks(), fake.fetch);
    await expect(deps.discordIdentity('code')).rejects.toMatchObject({
      status: 503,
      code: 'provider_unavailable',
    });
    await expect(deps.sendCode('test@example.com', '123456')).rejects.toThrow(
      'Email binding missing',
    );
    await expect(deps.limit('key')).rejects.toMatchObject({ status: 503 });
    await expect(deps.limitInitiation('key')).rejects.toMatchObject({ status: 503 });
  });
  it('registers background work on the provided execution context', async () => {
    const context = new BackgroundTasks();
    const pending = deferred();
    authDependencies(env(), context).waitUntil(pending.promise);
    let completed = false;
    const draining = context.drain().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    pending.resolve();
    await draining;
    expect(completed).toBe(true);
  });
  it('uses unpredictable tokens and keyed, challenge-specific code hashes', async () => {
    const tokens = Array.from({ length: 100 }, randomToken);
    expect(new Set(tokens).size).toBe(100);
    expect(tokens.every((token) => /^[a-f0-9]{64}$/.test(token))).toBe(true);
    expect(
      Array.from({ length: 100 }, randomCode).every((code) => /^\d{6}$/.test(code)),
    ).toBe(true);
    const hash = await codeHash('secret', 'challenge', '123456');
    expect(hash).not.toBe(await codeHash('secret', 'different', '123456'));
    expect(hash).not.toBe(await codeHash('different', 'challenge', '123456'));
  });
});
