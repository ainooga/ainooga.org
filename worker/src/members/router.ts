import { jsonBody, reject } from '../auth/http.js';
import { memberSchema, type Row } from './schemas.js';
import { importSql, snapshot } from './sql.js';
import { peopleWrites } from './people.js';
import { eventWrites } from './events.js';
import { importReport } from './report.js';

export async function importMember(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'POST') reject(405, 'method', 'Use POST for member imports.');
  const input = await jsonBody(request, memberSchema);
  const preview = new URL(request.url).pathname.endsWith('/preview');
  const sql = importSql(db, input);
  const reads = snapshot(sql, input);
  // Reads and writes share one transaction. The report describes the state at
  // commit, rather than a stale preflight read performed outside the batch.
  const results = await db.batch<Row>([
    ...reads,
    ...(preview ? [] : [...peopleWrites(sql, input), ...eventWrites(sql, input)]),
  ]);
  const report = importReport(
    results.slice(0, reads.length).map((r) => r.results),
    input,
  );
  if (!preview && report.conflicts.length > 0)
    reject(
      409,
      'identity_conflict',
      'Source and email associations require reconciliation.',
    );
  return Response.json(report);
}
