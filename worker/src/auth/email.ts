import { z } from 'zod';
import type { Env } from '../types.js';
import type { AuthDependencies, Poll } from './types.js';
import { cookie, setCookie } from './cookies.js';
import { codeHash, hashToken } from './crypto.js';
import { jsonBody, reject } from './http.js';
import { eligibleIdentity } from './store.js';
import { checkBot, removeSession } from './sessions.js';
import { createEmailChallenge, consumeEmail } from './email-store.js';

const requestSchema = z
  .object({
    email: z.string().trim().max(254).email(),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
const verifySchema = z
  .object({
    challengeId: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

function emailSecret(env: Env): string {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    return reject(503, 'configuration', 'Email verification is not configured.');
  return env.AUTH_SECRET;
}

export async function requestEmail(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Poll,
): Promise<Response> {
  const secret = emailSecret(env);
  const input = await jsonBody(request, requestSchema);
  await checkBot(input.turnstileToken, deps);
  const id = deps.random();
  const browser = cookie(request, env.SITE_URL, 'challenge') ?? deps.random();
  const address = input.email.toLowerCase();
  const identity = await eligibleIdentity(deps.db, poll.id, 'email', address);
  if (identity) {
    const code = deps.code();
    const created = await createEmailChallenge(
      deps,
      poll,
      identity,
      id,
      await hashToken(browser),
      await codeHash(secret, id, code),
    );
    if (created) await deliver(deps, address, code, id);
  }
  const response = Response.json(
    {
      challengeId: id,
      message:
        'If eligible, you will receive a code. You can request another after one minute.',
    },
    { status: 202 },
  );
  setCookie(response, env.SITE_URL, 'challenge', browser, 86400);
  return response;
}

async function deliver(
  deps: AuthDependencies,
  address: string,
  code: string,
  id: string,
): Promise<void> {
  try {
    await deps.sendCode(address, code);
  } catch {
    await deps.db
      .prepare('UPDATE auth_challenges SET consumed_by = ? WHERE id = ?')
      .bind('delivery_failed', id)
      .run();
    console.error(JSON.stringify({ event: 'verification_delivery_failed' }));
  }
}

export async function verifyEmail(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Poll,
): Promise<Response> {
  const secret = emailSecret(env);
  const input = await jsonBody(request, verifySchema);
  const browser = cookie(request, env.SITE_URL, 'challenge');
  if (!browser)
    return reject(400, 'invalid_code', 'Invalid or expired verification code.');
  const token = deps.random();
  const consumed = await consumeEmail(
    deps,
    poll,
    input.challengeId,
    await hashToken(browser),
    await codeHash(secret, input.challengeId, input.code),
    await hashToken(token),
  );
  if (!consumed)
    return reject(400, 'invalid_code', 'Invalid or expired verification code.');
  await removeSession(request, env, deps, 'voter');
  const response = Response.json({ authenticated: true, assurance: 'verified' });
  setCookie(response, env.SITE_URL, 'voter', token, 86400);
  return response;
}
