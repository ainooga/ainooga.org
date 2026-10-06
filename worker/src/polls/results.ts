import { eligiblePerson } from './eligibility.js';
import { getPoll } from './store.js';

export function resultStatements(db: D1Database, pollId: number) {
  return [
    db
      .prepare(
        `SELECT o.id,o.label,count(v.option_id) AS votes FROM poll_options o
      LEFT JOIN (SELECT c.option_id FROM poll_ballot_choices c
        JOIN poll_ballots b ON b.id=c.ballot_id WHERE b.poll_id=?) v ON v.option_id=o.id
      WHERE o.poll_id=? GROUP BY o.id ORDER BY o.position,o.id`,
      )
      .bind(pollId, pollId),
    db
      .prepare(
        `SELECT (SELECT count(*) FROM people person WHERE ${eligiblePerson('person.id')}) AS eligibleCount,
      (SELECT count(*) FROM poll_ballots WHERE poll_id=p.id) AS ballotCount FROM polls p WHERE p.id=?`,
      )
      .bind(pollId),
  ];
}
export function resultsBody(results: D1Result<Record<string, unknown>>[]) {
  return { ...results[1]!.results[0], options: results[0]!.results };
}
export async function organizerResults(db: D1Database, slug: string) {
  const p = await getPoll(db, slug);
  return resultsBody(await db.batch<Record<string, unknown>>(resultStatements(db, p.id)));
}
export async function organizerBallots(db: D1Database, slug: string) {
  const p = await getPoll(db, slug);
  const rows = await db
    .prepare(
      `SELECT b.person_id AS personId,p.name,b.revision,b.submitted_at AS submittedAt,b.updated_at AS updatedAt,${eligiblePerson('b.person_id', 'poll')} AS currentlyEligible,
    (SELECT json_group_array(json_object('kind',kind,'value',value)) FROM person_identifiers WHERE person_id=p.id AND kind IN ('email','discord')) AS identifiers,
    (SELECT json_group_array(option_id) FROM poll_ballot_choices WHERE ballot_id=b.id) AS selections
    FROM poll_ballots b JOIN people p ON p.id=b.person_id JOIN polls poll ON poll.id=b.poll_id
    WHERE b.poll_id=? ORDER BY b.person_id`,
    )
    .bind(p.id)
    .all();
  return rows.results.map(({ identifiers, selections, ...row }) => ({
    ...row,
    currentlyEligible: row.currentlyEligible === 1,
    identifiers: JSON.parse(String(identifiers)) as unknown,
    optionIds: JSON.parse(String(selections)) as number[],
  }));
}
