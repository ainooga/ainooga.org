import { reject } from '../auth/http.js';
import { adminDetail, getPoll } from './store.js';

// Evaluate all publication requirements inside the transaction, before snapshotting.
const publishable = `p.status = 'draft' AND p.ends_at > ?
  AND NOT EXISTS (SELECT 1 FROM poll_eligible_tags e WHERE e.poll_id=p.id
    AND NOT EXISTS (SELECT 1 FROM person_tags t WHERE t.tag=e.tag))
  AND p.min_selections <= (SELECT count(*) FROM poll_options WHERE poll_id=p.id) + p.allow_write_ins
  AND EXISTS (
    SELECT person_id FROM poll_allowlist WHERE poll_id=p.id AND revoked_at IS NULL
    UNION SELECT t.person_id FROM person_tags t JOIN poll_eligible_tags e ON e.tag=t.tag
      WHERE e.poll_id=p.id AND NOT EXISTS (SELECT 1 FROM poll_allowlist a
        WHERE a.poll_id=p.id AND a.person_id=t.person_id AND a.revoked_at IS NOT NULL))`;
export async function publishPoll(db: D1Database, slug: string, now: string) {
  const p = await getPoll(db, slug);
  await db.batch([
    db
      .prepare(
        `INSERT INTO poll_allowlist (poll_id,person_id,added_at)
      SELECT DISTINCT p.id,t.person_id,? FROM polls p JOIN poll_eligible_tags e ON e.poll_id=p.id
      JOIN person_tags t ON t.tag=e.tag WHERE p.id=? AND ${publishable}
      ON CONFLICT DO NOTHING`,
      )
      .bind(now, p.id, now),
    db
      .prepare(
        `UPDATE polls AS p SET status='published',updated_at=? WHERE p.id=? AND ${publishable}`,
      )
      .bind(now, p.id, now),
  ]);
  const detail = await adminDetail(db, slug);
  if (detail.status !== 'published')
    reject(
      409,
      'cannot_publish',
      'Publish requires a draft, existing tags, active voters, valid choices, and an unexpired schedule.',
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
