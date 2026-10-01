import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { jsonBody, reject } from '../auth/http.js';
import {
  loginRequirements,
  requireSession,
  sessionStatement,
  voterIdentity,
} from './access.js';
import type { PollRow } from './store.js';
import { getPoll, config } from './store.js';
import { ballotSchema } from './schemas.js';
import { ballotResult, ballotStatement } from './ballot-read.js';
import { submitBallot } from './ballots.js';
import { resultStatements, resultsBody } from './results.js';

export async function voterPoll(
  request: Request,
  env: Env,
  deps: AuthDependencies,
  slug: string,
  action: string,
) {
  const p = await getPoll(deps.db, slug);
  if (action === 'access' && request.method === 'GET')
    return Response.json(loginRequirements(p, env));
  const voter = await voterIdentity(request, env, deps, p);
  if (action === 'ballot' && request.method === 'PUT')
    return Response.json(
      await submitBallot(deps, p, voter, await jsonBody(request, ballotSchema)),
    );
  if (request.method !== 'GET') reject(405, 'method', 'Method not allowed.');
  const data = await deps.db.batch<Record<string, unknown>>([
    sessionStatement(deps.db, voter, p.id, deps.now().toISOString()),
    ballotStatement(deps.db, p.id, voter.personId),
    deps.db.prepare('SELECT * FROM polls WHERE id=?').bind(p.id),
    deps.db
      .prepare(
        'SELECT id,label,origin,position FROM poll_options WHERE poll_id=? ORDER BY position,id',
      )
      .bind(p.id),
    ...resultStatements(deps.db, p.id),
  ]);
  return readResponse(p, action, data);
}

function readResponse(
  p: PollRow,
  action: string,
  data: D1Result<Record<string, unknown>>[],
) {
  requireSession(data[0]!);
  const ballot = ballotResult(data[1]!);
  if (action === 'ballot') return Response.json(ballot);
  if (action === 'results') {
    if (
      p.results_visibility === 'never' ||
      (p.results_visibility === 'after_vote' && !ballot)
    )
      reject(403, 'hidden_results', 'Results are not available to this voter.');
    return Response.json(resultsBody(data.slice(4)));
  }
  if (action !== '') reject(404, 'not_found', 'Endpoint not found.');
  return Response.json({
    ...config(data[2]!.results[0] as unknown as PollRow),
    options: data[3]!.results,
    ballot,
  });
}
