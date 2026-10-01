import { reject } from '../auth/http.js';
import type { PollInput } from './schemas.js';

export interface PollRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  identity_mode: 'honor' | 'verified';
  min_selections: number;
  max_selections: number | null;
  allow_write_ins: number;
  results_visibility: 'before_vote' | 'after_vote' | 'never';
  starts_at: string;
  ends_at: string;
  allow_edits: number;
  edit_deadline: string | null;
}
export async function getPoll(db: D1Database, slug: string): Promise<PollRow> {
  return (
    (await db
      .prepare('SELECT * FROM polls WHERE slug = ?')
      .bind(slug)
      .first<PollRow>()) ?? reject(404, 'not_found', 'Poll not found.')
  );
}
export async function options(db: D1Database, id: number) {
  return (
    await db
      .prepare(
        'SELECT id,label,origin,position FROM poll_options WHERE poll_id = ? ORDER BY position,id',
      )
      .bind(id)
      .all<{ id: number; label: string; origin: string; position: number }>()
  ).results;
}
export async function tags(db: D1Database, id: number): Promise<string[]> {
  return (
    await db
      .prepare('SELECT tag FROM poll_eligible_tags WHERE poll_id = ? ORDER BY tag')
      .bind(id)
      .all<{ tag: string }>()
  ).results.map((r) => r.tag);
}
export function config(p: PollRow) {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description ?? '',
    identityMode: p.identity_mode,
    minSelections: p.min_selections,
    maxSelections: p.max_selections,
    allowWriteIns: p.allow_write_ins === 1,
    resultsVisibility: p.results_visibility,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    allowEdits: p.allow_edits === 1,
    editDeadline: p.edit_deadline,
  };
}
export async function definition(db: D1Database, p: PollRow): Promise<PollInput> {
  return {
    ...config(p),
    options: (await options(db, p.id))
      .filter((o) => o.origin === 'predefined')
      .map((o) => o.label),
    eligibleTags: await tags(db, p.id),
  };
}
export const activeVoters = `SELECT person_id FROM poll_allowlist WHERE poll_id = ? AND revoked_at IS NULL`;
export const tagVoters = `SELECT DISTINCT t.person_id FROM person_tags t JOIN poll_eligible_tags e ON e.tag = t.tag WHERE e.poll_id = ?`;
export const effectiveVoters = `${activeVoters} UNION SELECT person_id FROM (${tagVoters}) WHERE person_id NOT IN (SELECT person_id FROM poll_allowlist WHERE poll_id = ? AND revoked_at IS NOT NULL)`;
export async function preview(db: D1Database, p: PollRow) {
  const missing = (
    await db
      .prepare(
        'SELECT tag FROM poll_eligible_tags WHERE poll_id = ? AND NOT EXISTS (SELECT 1 FROM person_tags WHERE tag = poll_eligible_tags.tag)',
      )
      .bind(p.id)
      .all<{ tag: string }>()
  ).results.map((r) => r.tag);
  const sql = p.status === 'draft' ? effectiveVoters : activeVoters;
  const args = p.status === 'draft' ? [p.id, p.id, p.id] : [p.id];
  const count = await db
    .prepare(`SELECT count(*) AS total FROM (${sql})`)
    .bind(...args)
    .first<{ total: number }>();
  return {
    eligibleCount: count!.total,
    missingTags: missing,
    snapshot: p.status !== 'draft',
  };
}
export async function adminDetail(db: D1Database, slug: string) {
  const p = await getPoll(db, slug);
  return {
    ...(await definition(db, p)),
    status: p.status,
    optionRecords: await options(db, p.id),
    eligibility: await preview(db, p),
  };
}
