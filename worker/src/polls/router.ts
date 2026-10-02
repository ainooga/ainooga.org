import { z } from 'zod';
import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { jsonBody, reject } from '../auth/http.js';
import { pollSchema, eligibilitySchema } from './schemas.js';
import { adminDetail } from './store.js';
import { createPoll, updatePoll } from './manage.js';
import { publishPoll, archivePoll } from './lifecycle.js';
import { changeAllowlist, listAllowlist } from './allowlist.js';
import { organizerResults, organizerBallots } from './results.js';

export function pollsReady(env: Env): void {
  if (env.POLLS_READY !== 'true') reject(503, 'not_ready', 'Polling is not enabled yet.');
}
export async function adminPolls(
  request: Request,
  deps: AuthDependencies,
  actorId: number,
) {
  const path = new URL(request.url).pathname;
  if (path === '/api/admin/polls') return collection(request, deps, actorId);
  const match =
    /^\/api\/admin\/polls\/([a-zA-Z0-9_-]{1,160})(?:\/(publish|archive|allowlist|results|ballots))?$/.exec(
      path,
    );
  if (!match) reject(404, 'not_found', 'Endpoint not found.');
  const slug = match[1]!;
  const action = match[2] ?? '';
  if (request.method === 'GET')
    return Response.json(await readAdmin(deps.db, slug, action));
  if (action === '' && request.method === 'PUT')
    return Response.json(
      await updatePoll(
        deps.db,
        slug,
        await jsonBody(request, pollSchema),
        deps.now().toISOString(),
      ),
    );
  if (request.method !== 'POST') reject(405, 'method', 'Method not allowed.');
  return Response.json(await actionAdmin(request, deps, slug, action));
}
async function collection(request: Request, deps: AuthDependencies, actorId: number) {
  if (request.method === 'GET')
    return Response.json(
      (
        await deps.db
          .prepare(
            'SELECT slug,title,status,starts_at AS startsAt,ends_at AS endsAt FROM polls ORDER BY id DESC',
          )
          .all()
      ).results,
    );
  if (request.method === 'POST')
    return Response.json(
      await createPoll(
        deps.db,
        await jsonBody(request, pollSchema),
        actorId,
        deps.now().toISOString(),
      ),
      { status: 201 },
    );
  return reject(405, 'method', 'Method not allowed.');
}
async function readAdmin(db: D1Database, slug: string, action: string) {
  switch (action) {
    case '':
      return adminDetail(db, slug);
    case 'allowlist':
      return listAllowlist(db, slug);
    case 'results':
      return organizerResults(db, slug);
    case 'ballots':
      return organizerBallots(db, slug);
    default:
      return reject(405, 'method', 'Method not allowed.');
  }
}
async function actionAdmin(
  request: Request,
  deps: AuthDependencies,
  slug: string,
  action: string,
) {
  if ((action === 'publish' || action === 'archive') && request.body !== null)
    await jsonBody(request, z.object({}).strict());
  const now = deps.now().toISOString();
  switch (action) {
    case 'publish':
      return publishPoll(deps.db, slug, now);
    case 'archive':
      return archivePoll(deps.db, slug, now);
    case 'allowlist':
      return changeAllowlist(
        deps.db,
        slug,
        await jsonBody(request, eligibilitySchema),
        now,
      );
    default:
      return reject(405, 'method', 'Method not allowed.');
  }
}
