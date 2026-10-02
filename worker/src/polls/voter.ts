import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { jsonBody, reject } from '../auth/http.js';
import { loginRequirements, voterIdentity } from './access.js';
import { getPoll } from './store.js';
import { ballotSchema } from './schemas.js';
import { submitBallot } from './ballots.js';
import { readBallot, readDetails, readResults } from './voter-read.js';

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
  switch (action) {
    case 'ballot':
      return Response.json(await readBallot(deps.db, p, voter));
    case 'results':
      return Response.json(await readResults(deps.db, p, voter));
    case '':
      return Response.json(await readDetails(deps.db, p, voter));
    default:
      return reject(404, 'not_found', 'Endpoint not found.');
  }
}
