import { z } from 'zod';
import type { Env } from '../types.js';
import type { AuthContext, AuthDependencies } from './types.js';
import { randomCode, randomToken } from './crypto.js';
import { callbackUrl } from './discord.js';
import { reject } from './http.js';

async function providerJson(response: Response): Promise<unknown> {
  if (!response.ok)
    return reject(
      503,
      'provider_unavailable',
      'Identity provider is temporarily unavailable.',
    );
  return response.json();
}

async function discordIdentity(
  env: Env,
  code: string,
  fetcher: typeof fetch,
): Promise<string> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
    return reject(503, 'configuration', 'Discord verification is not configured.');
  const exchange = await fetcher('https://discord.com/api/oauth2/token', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(env),
    }),
  });
  const token = z
    .object({ access_token: z.string().min(1) })
    .parse(await providerJson(exchange));
  const user = await fetcher('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  return z.object({ id: z.string().regex(/^\d{17,20}$/) }).parse(await providerJson(user))
    .id;
}

async function verifyBot(
  env: Env,
  token: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  const response = await fetcher(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
    },
  );
  const body = z
    .object({
      success: z.boolean(),
      hostname: z.string().optional(),
      action: z.string().optional(),
    })
    .parse(await providerJson(response));
  return (
    body.success &&
    body.hostname === new URL(env.SITE_URL).hostname &&
    body.action === 'poll-auth'
  );
}

export function authDependencies(
  env: Env,
  context: AuthContext,
  fetcher: typeof fetch = fetch,
): AuthDependencies {
  return {
    db: env.DB,
    now: () => new Date(),
    random: randomToken,
    code: randomCode,
    waitUntil: (task) => context.waitUntil(task),
    async sendCode(address, code) {
      if (!env.EMAIL) throw new Error('Email binding missing');
      await env.EMAIL.send({
        from: 'noreply@ainooga.org',
        to: address,
        subject: 'Your AI Nooga verification code',
        text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`,
      });
    },
    verifyBot: (token) => verifyBot(env, token, fetcher),
    discordIdentity: (code) => discordIdentity(env, code, fetcher),
    async limitInitiation(key) {
      if (!env.AUTH_INITIATION_RATE_LIMITER)
        return reject(503, 'configuration', 'Authentication is not configured.');
      return (await env.AUTH_INITIATION_RATE_LIMITER.limit({ key })).success;
    },
    async limit(key) {
      if (!env.AUTH_RATE_LIMITER)
        return reject(503, 'configuration', 'Authentication is not configured.');
      return (await env.AUTH_RATE_LIMITER.limit({ key })).success;
    },
  };
}
