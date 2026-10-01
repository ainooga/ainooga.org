import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { cookie } from '../auth/cookies.js';
import { hashToken } from '../auth/crypto.js';
import { readSession } from '../auth/store.js';
import { reject } from '../auth/http.js';
import type { PollRow } from './store.js';

export const sessionFrom = `FROM voter_sessions s
  JOIN person_identifiers i ON i.id=s.identifier_id AND i.person_id=s.person_id AND i.normalized_value=s.identifier_value
  JOIN poll_allowlist a ON a.person_id=s.person_id
  JOIN polls p ON p.id=a.poll_id`;
export const sessionWhere = `s.token_hash=? AND s.expires_at>? AND p.id=? AND a.revoked_at IS NULL
  AND p.status='published' AND (s.assurance='verified' OR (s.poll_id=p.id AND p.identity_mode='honor'))`;
export interface Voter {
  personId: number;
  hash: string;
}
export async function voterIdentity(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  p: PollRow,
): Promise<Voter> {
  if (p.status !== 'published') reject(404, 'not_found', 'Poll not found.');
  for (const kind of ['honor', 'voter'] as const) {
    const token = cookie(request, env.SITE_URL, kind);
    if (!token) continue;
    const hash = await hashToken(token);
    const found = await readSession(deps.db, hash, p, deps.now());
    if (found) return { personId: found.person_id, hash };
  }
  return reject(
    401,
    'login_required',
    'Log in with an eligible identity to access this poll.',
  );
}
export function sessionStatement(
  db: D1Database,
  voter: Voter,
  pollId: number,
  now: string,
) {
  return db
    .prepare(`SELECT s.person_id ${sessionFrom} WHERE ${sessionWhere}`)
    .bind(voter.hash, now, pollId);
}
export function requireSession(result: D1Result<Record<string, unknown>>): void {
  if (result.results.length !== 1)
    reject(
      401,
      'login_required',
      'Log in with an eligible identity to access this poll.',
    );
}
export function loginRequirements(p: PollRow, env: Env) {
  if (p.status !== 'published') reject(404, 'not_found', 'Poll not found.');
  const methods = p.identity_mode === 'honor' ? ['honor'] : ['email'];
  if (
    p.identity_mode === 'verified' &&
    env.DISCORD_CLIENT_ID &&
    env.DISCORD_CLIENT_SECRET
  )
    methods.push('discord');
  return { identityMode: p.identity_mode, methods };
}
