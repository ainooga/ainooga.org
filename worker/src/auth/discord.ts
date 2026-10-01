import { z } from 'zod';
import type { Env } from '../types.js';
import type { AuthDependencies, Poll } from './types.js';
import { jsonBody, reject } from './http.js';
import { cookie, setCookie } from './cookies.js';
import { hashToken } from './crypto.js';
import { checkBot, removeSession } from './sessions.js';
import { eligibleIdentity, findPoll } from './store.js';
import { finishDiscord, type DiscordChallenge } from './discord-store.js';

export function callbackUrl(env: Env): string {
  return new URL('/api/auth/discord/callback', env.SITE_URL).href;
}

export async function startDiscord(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Poll,
): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
    return reject(503, 'configuration', 'Discord verification is not configured.');
  const input = await jsonBody(
    request,
    z.object({ turnstileToken: z.string().min(1).max(2048) }).strict(),
  );
  await checkBot(input.turnstileToken, deps);
  const state = deps.random();
  const browser = cookie(request, env.SITE_URL, 'challenge') ?? deps.random();
  const now = deps.now();
  await deps.db
    .prepare(
      `INSERT INTO auth_challenges (id,kind,poll_id,browser_hash,created_at,expires_at)
    VALUES (?,'discord',?,?,?,?)`,
    )
    .bind(
      await hashToken(state),
      poll.id,
      await hashToken(browser),
      now.toISOString(),
      new Date(now.getTime() + 600000).toISOString(),
    )
    .run();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: callbackUrl(env),
    scope: 'identify',
    state,
  }).toString();
  const response = Response.json({ url: url.href });
  setCookie(response, env.SITE_URL, 'challenge', browser, 86400);
  return response;
}

async function consumeState(
  request: Request,
  env: Env,
  deps: AuthDependencies,
): Promise<DiscordChallenge> {
  const state = new URL(request.url).searchParams.get('state');
  const browser = cookie(request, env.SITE_URL, 'challenge');
  if (!state || !/^[a-f0-9]{64}$/.test(state) || !browser)
    return reject(400, 'invalid_state', 'Invalid or expired Discord login.');
  const id = await hashToken(state);
  const browserHash = await hashToken(browser);
  const record = await deps.db
    .prepare(
      `UPDATE auth_challenges SET consumed_by = 'discord_exchange'
    WHERE id = ? AND browser_hash = ? AND kind = 'discord' AND consumed_by IS NULL AND expires_at > ?
    RETURNING poll_id`,
    )
    .bind(id, browserHash, deps.now().toISOString())
    .first<{ poll_id: number }>();
  if (!record) return reject(400, 'invalid_state', 'Invalid or expired Discord login.');
  const row = await deps.db
    .prepare('SELECT slug FROM polls WHERE id = ?')
    .bind(record.poll_id)
    .first<{ slug: string }>();
  return { id, browserHash, poll: await findPoll(deps.db, row?.slug ?? '') };
}

export async function completeDiscord(
  request: Request,
  env: Env,
  deps: AuthDependencies,
): Promise<Response> {
  const challenge = await consumeState(request, env, deps);
  const { poll } = challenge;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || !code || code.length > 2048)
    return reject(400, 'discord_denied', 'Discord login was not completed.');
  const discordId = await deps.discordIdentity(code);
  const identity = await eligibleIdentity(deps.db, poll.id, 'discord', discordId);
  if (!identity)
    return reject(403, 'ineligible', 'This Discord identity cannot access the poll.');
  const token = deps.random();
  const hash = await hashToken(token);
  if (!(await finishDiscord(deps, challenge, identity, hash)))
    return reject(400, 'invalid_state', 'Invalid or expired Discord login.');
  await removeSession(request, env, deps, 'voter');
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: `${new URL(env.SITE_URL).origin}/#/polls/${encodeURIComponent(poll.slug)}`,
    },
  });
  setCookie(response, env.SITE_URL, 'voter', token, 86400);
  return response;
}
