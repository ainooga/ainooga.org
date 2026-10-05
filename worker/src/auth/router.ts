import { adminPolls, pollsReady } from '../polls/router.js';
import { voterPoll } from '../polls/voter.js';
import type { Env } from '../types.js';
import type { AuthContext, AuthDependencies } from './types.js';
import { apiFailure, reject, requireOrigin } from './http.js';
import { organizer, linkIdentifier } from './organizers.js';
import { authDependencies } from './providers.js';
import { hashToken } from './crypto.js';
import { findPoll } from './store.js';
import { honor, session, logout } from './sessions.js';
import { requestEmail, verifyEmail } from './email.js';
import { startDiscord, completeDiscord } from './discord.js';
import { importMember } from '../members/router.js';

export function isAuthRoute(path: string): boolean {
  return (
    path.startsWith('/api/admin/') ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/polls/')
  );
}

async function admin(
  request: Request,
  env: Env,
  deps: AuthDependencies,
): Promise<Response> {
  if (request.headers.has('Origin')) requireOrigin(request, env.SITE_URL);
  const actor = await organizer(request, env.ORGANIZER_API_TOKENS);
  const exists = await deps.db
    .prepare('SELECT id FROM people WHERE id = ?')
    .bind(actor.personId)
    .first();
  if (!exists) return reject(503, 'configuration', 'Organizer person record is missing.');
  const path = new URL(request.url).pathname;
  if (path === '/api/admin/me' && request.method === 'GET') return Response.json(actor);
  if (
    path === '/api/admin/members/import' ||
    path === '/api/admin/members/import/preview'
  )
    return importMember(request, deps.db);
  if (path === '/api/admin/polls' || path.startsWith('/api/admin/polls/')) {
    pollsReady(env);
    return adminPolls(request, deps, actor.personId);
  }
  return adminPerson(request, deps.db, path);
}

async function adminPerson(
  request: Request,
  db: D1Database,
  path: string,
): Promise<Response> {
  const match = /^\/api\/admin\/people\/([1-9]\d*)\/identifiers$/.exec(path);
  if (match && request.method === 'POST') {
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id)) return reject(400, 'invalid_id', 'Invalid person ID.');
    return linkIdentifier(request, db, id);
  }
  return reject(404, 'not_found', 'Endpoint not found.');
}

async function voter(
  request: Request,
  env: Env,
  deps: AuthDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET') requireOrigin(request, env.SITE_URL);
  if (path === '/api/auth/logout' && request.method === 'POST')
    return logout(request, env, deps);
  if (path === '/api/auth/discord/callback' && request.method === 'GET')
    return completeDiscord(request, env, deps);
  const pollMatch =
    /^\/api\/polls\/([a-zA-Z0-9_-]{1,160})(?:\/(access|ballot|results))?$/.exec(path);
  if (pollMatch) {
    pollsReady(env);
    return voterPoll(request, env, deps, pollMatch[1]!, pollMatch[2] ?? '');
  }
  return voterAuth(request, env, deps, path);
}

async function voterAuth(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  path: string,
): Promise<Response> {
  const match = /^\/api\/polls\/([a-zA-Z0-9_-]{1,160})\/(session|auth\/[a-z/]+)$/.exec(
    path,
  );
  if (!match) return reject(404, 'not_found', 'Endpoint not found.');
  const poll = await findPoll(deps.db, match[1]!);
  if (match[2] === 'session' && request.method === 'GET')
    return session(request, env, deps, poll);
  if (request.method !== 'POST') return reject(405, 'method', 'Method not allowed.');
  return pollAction(match[2]!, request, env, deps, poll);
}

async function pollAction(
  action: string,
  request: Request,
  env: Env,
  deps: AuthDependencies,
  poll: Awaited<ReturnType<typeof findPoll>>,
): Promise<Response> {
  if (['auth/honor', 'auth/email/request', 'auth/discord/start'].includes(action)) {
    const key = await hashToken(
      `${request.headers.get('CF-Connecting-IP') ?? 'local'}:initiation`,
    );
    if (!(await deps.limitInitiation(key)))
      reject(429, 'rate_limit', 'Too many requests. Try again shortly.');
  }
  switch (action) {
    case 'auth/honor':
      return honor(request, env, deps, poll);
    case 'auth/email/request':
      return requestEmail(request, env, deps, poll);
    case 'auth/email/verify':
      return verifyEmail(request, env, deps, poll);
    case 'auth/discord/start':
      return startDiscord(request, env, deps, poll);
    default:
      return reject(404, 'not_found', 'Endpoint not found.');
  }
}

export async function handleAuth(
  request: Request,
  env: Env,
  context: AuthContext,
  dependencies?: AuthDependencies,
): Promise<Response> {
  let response: Response;
  try {
    if (env.AUTH_READY !== 'true' || env.CHAPTER_SCHEMA_READY !== 'true')
      reject(503, 'not_ready', 'Authentication is not enabled yet.');
    const deps = dependencies ?? authDependencies(env, context);
    const key = await hashToken(
      `${request.headers.get('CF-Connecting-IP') ?? 'local'}:auth`,
    );
    if (!(await deps.limit(key)))
      reject(429, 'rate_limit', 'Too many requests. Try again shortly.');
    response = new URL(request.url).pathname.startsWith('/api/admin/')
      ? await admin(request, env, deps)
      : await voter(request, env, deps);
  } catch (error) {
    response = apiFailure(error);
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
