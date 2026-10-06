import { eligiblePerson } from './eligibility.js';
import { reject } from '../auth/http.js';
import { adminDetail, getPoll } from './store.js';

// Validate publication against current tags and explicit exceptions in one statement.
const publishable = `p.status='draft' AND p.ends_at>?
  AND NOT EXISTS (SELECT 1 FROM json_each(p.eligible_tags) e
    WHERE NOT EXISTS (SELECT 1 FROM person_tags t WHERE t.tag=e.value))
  AND p.min_selections <= (SELECT count(*) FROM poll_options WHERE poll_id=p.id) + p.allow_write_ins
  AND EXISTS (SELECT 1 FROM people person WHERE ${eligiblePerson('person.id')})`;
export async function publishPoll(db: D1Database, slug: string, now: string) {
  const p = await getPoll(db, slug);
  await db
    .prepare(
      `UPDATE polls AS p SET status='published',updated_at=? WHERE id=? AND ${publishable}`,
    )
    .bind(now, p.id, now)
    .run();
  const detail = await adminDetail(db, slug);
  if (detail.status !== 'published')
    reject(
      409,
      'cannot_publish',
      'Publish requires a draft, existing tags, eligible voters, valid choices, and an unexpired schedule.',
    );
  return detail;
}
export async function archivePoll(db: D1Database, slug: string, now: string) {
  await getPoll(db, slug);
  await db
    .prepare(
      "UPDATE polls SET status='archived',updated_at=? WHERE slug=? AND status!='archived'",
    )
    .bind(now, slug)
    .run();
  return adminDetail(db, slug);
}
