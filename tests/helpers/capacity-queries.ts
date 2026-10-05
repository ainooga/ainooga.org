import { expect } from 'vitest';
import { AuthFakes } from './auth';
import { getPoll } from '../../worker/src/polls/store';
import { readDetails, readResults } from '../../worker/src/polls/voter-read';
import { resultStatements } from '../../worker/src/polls/results';
import { submitBallot } from '../../worker/src/polls/ballots';

export async function exercisePoll(db: D1Database) {
  const hash = 'e'.repeat(64);
  await db
    .prepare(
      `INSERT INTO voter_sessions
    (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
    VALUES (?,1,1,'member1@example.com','honor',120,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')`,
    )
    .bind(hash)
    .run();
  try {
    const poll = await getPoll(db, 'capacity-120');
    const voter = { personId: 1, hash };
    const details = await readDetails(db, poll, voter);
    expect(details.options).toHaveLength(30);
    const input = {
      requestId: crypto.randomUUID(),
      sessionContext: details.sessionContext,
      expectedRevision: 1,
      optionIds: [3571, 3572],
      writeIn: null,
    };
    const deps = new AuthFakes(db);
    const accepted = await submitBallot(deps, poll, voter, input);
    expect(accepted.revision).toBe(2);
    expect(await submitBallot(deps, poll, voter, input)).toEqual(accepted);
    expect(await readResults(db, poll, voter)).toMatchObject({
      ballotCount: 200,
      eligibleCount: 200,
    });
    const reads = await db.batch(resultStatements(db, poll.id));
    console.info(
      'Synthetic results query rows read:',
      reads.map((r) => r.meta.rows_read),
    );
    const plans = await db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id,label FROM poll_options WHERE poll_id=? ORDER BY position,id',
      )
      .bind(120)
      .all();
    expect(
      plans.results.some((row) => String(row.detail).includes('idx_options_order')),
    ).toBe(true);
  } finally {
    await db.prepare('DELETE FROM voter_sessions WHERE token_hash=?').bind(hash).run();
  }
}
