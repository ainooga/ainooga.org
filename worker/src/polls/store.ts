import { eligiblePerson } from './eligibility.js';
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
  eligible_tags: string;
  allowed_person_ids: string;
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
        'SELECT id,label,origin,position,description FROM poll_options WHERE poll_id = ? ORDER BY position,id',
      )
      .bind(id)
      .all<{
        id: number;
        label: string;
        origin: string;
        position: number;
        description: string | null;
      }>()
  ).results;
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
      .map((o) =>
        o.description === null ? o.label : { label: o.label, description: o.description },
      ),
    eligibleTags: JSON.parse(p.eligible_tags) as string[],
  };
}
export async function preview(db: D1Database, p: PollRow) {
  const missing = (
    await db
      .prepare(
        `SELECT j.value AS tag FROM polls p,json_each(p.eligible_tags) j
    WHERE p.id=? AND NOT EXISTS (SELECT 1 FROM person_tags WHERE tag=j.value)`,
      )
      .bind(p.id)
      .all<{ tag: string }>()
  ).results.map((r) => r.tag);
  const count = await db
    .prepare(
      `SELECT count(*) AS total FROM people person JOIN polls p
    ON ${eligiblePerson('person.id')} WHERE p.id=?`,
    )
    .bind(p.id)
    .first<{ total: number }>();
  return { eligibleCount: count!.total, missingTags: missing };
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
