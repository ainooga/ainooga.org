import type { Env } from '../types.js';
import type { AuthDependencies, Poll } from './types.js';
import { cookie, setCookie } from './cookies.js';
import { hashToken } from './crypto.js';
import { readSession } from './store.js';
import { honorIdentifier, identifyGuest } from './honor-identity.js';
import { jsonBody, reject } from './http.js';
import { z } from 'zod';

const honorSchema = z
  .object({
    identifier: honorIdentifier,
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();

export async function checkBot(token: string, deps: AuthDependencies): Promise<void> {
  if (!(await deps.verifyBot(token)))
    reject(400, 'verification_failed', 'Verification failed. Try again.');
}

export async function honor(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Poll,
): Promise<Response> {
  if (poll.identity_mode !== 'honor')
    return reject(403, 'proof_required', 'This poll requires verified identity.');
  const input = await jsonBody(request, honorSchema);
  await checkBot(input.turnstileToken, deps);
  const token = deps.random();
  if (!(await identifyGuest(deps, poll, input.identifier, await hashToken(token))))
    return reject(403, 'ineligible', 'This identity cannot access the poll.');
  await removeSession(request, env, deps, 'honor');
  const response = Response.json({ authenticated: true, assurance: 'honor' });
  setCookie(response, env.SITE_URL, 'honor', token, 86400);
  return response;
}

export async function session(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Poll,
): Promise<Response> {
  for (const kind of ['honor', 'voter'] as const) {
    const token = cookie(request, env.SITE_URL, kind);
    if (!token) continue;
    const found = await readSession(deps.db, await hashToken(token), poll, deps.now());
    if (found)
      return Response.json({
        authenticated: true,
        personId: found.person_id,
        assurance: found.assurance,
        expiresAt: found.expires_at,
      });
  }
  return Response.json({ authenticated: false });
}

export async function removeSession(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  kind: 'honor' | 'voter',
): Promise<void> {
  const token = cookie(request, env.SITE_URL, kind);
  if (token)
    await deps.db
      .prepare('DELETE FROM voter_sessions WHERE token_hash = ?')
      .bind(await hashToken(token))
      .run();
}

export async function logout(
  request: Request,
  env: Env,
  deps: AuthDependencies,
): Promise<Response> {
  const hashes = await Promise.all(
    (['honor', 'voter', 'challenge'] as const).map(async (kind) => {
      const value = cookie(request, env.SITE_URL, kind);
      return value ? hashToken(value) : null;
    }),
  );
  // Delete associated sessions before replacing the challenge's session hash.
  // The transaction orders logout against both email and Discord issuance.
  await deps.db.batch([
    deps.db
      .prepare(
        `DELETE FROM voter_sessions WHERE token_hash IN (?,?)
      OR token_hash IN (SELECT consumed_by FROM auth_challenges WHERE browser_hash = ?)`,
      )
      .bind(...hashes),
    deps.db
      .prepare("UPDATE auth_challenges SET consumed_by = 'logout' WHERE browser_hash = ?")
      .bind(hashes[2]),
  ]);
  const response = Response.json({ authenticated: false });
  for (const kind of ['honor', 'voter', 'challenge'] as const)
    setCookie(response, env.SITE_URL, kind, '', 0);
  return response;
}
