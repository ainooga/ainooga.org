import { reject } from '../auth/http.js';
import type { PollInput } from './schemas.js';
import { normalizeLabel, optionValue } from './schemas.js';
import { adminDetail, definition, getPoll } from './store.js';
import { replaceEmailAllowlist } from './eligible-emails.js';

function draftChildren(db: D1Database, input: PollInput): D1PreparedStatement[] {
  const poll = "SELECT id FROM polls WHERE slug = ? AND status = 'draft'";
  return [
    db.prepare(`DELETE FROM poll_options WHERE poll_id IN (${poll})`).bind(input.slug),
    db
      .prepare(
        `INSERT INTO poll_options (poll_id,label,normalized_label,position,origin,description)
      SELECT p.id,json_extract(j.value,'$.label'),json_extract(j.value,'$.normalized'),j.key,'predefined',json_extract(j.value,'$.description')
      FROM polls p,json_each(?) j WHERE p.slug = ? AND p.status = 'draft'`,
      )
      .bind(
        JSON.stringify(
          input.options.map((o) => {
            const value = optionValue(o);
            return { ...value, normalized: normalizeLabel(value.label) };
          }),
        ),
        input.slug,
      ),
  ];
}
function values(p: PollInput) {
  return [
    p.title,
    p.description,
    p.identityMode,
    p.minSelections,
    p.maxSelections,
    Number(p.allowWriteIns),
    p.resultsVisibility,
    p.startsAt,
    p.endsAt,
    Number(p.allowEdits),
    p.editDeadline,
    JSON.stringify(p.eligibleTags),
  ];
}
export async function createPoll(
  db: D1Database,
  p: PollInput,
  personId: number,
  now: string,
) {
  // Unique slug must abort the entire batch; never overwrite an existing draft's children.
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO polls (title,description,identity_mode,min_selections,max_selections,allow_write_ins,results_visibility,starts_at,ends_at,allow_edits,edit_deadline,eligible_tags,slug,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(...values(p), p.slug, personId, now, now),
      ...draftChildren(db, p),
      ...replaceEmailAllowlist(db, p.slug, p.eligibleEmails, now, 'draft'),
    ]);
  } catch (error) {
    if (await db.prepare('SELECT id FROM polls WHERE slug = ?').bind(p.slug).first())
      reject(409, 'exists', 'A poll with this slug already exists.');
    throw error;
  }
  return adminDetail(db, p.slug);
}
export async function updatePoll(
  db: D1Database,
  slug: string,
  p: PollInput,
  now: string,
) {
  if (p.slug !== slug) reject(400, 'slug', 'Poll slug cannot change.');
  const existing = await getPoll(db, slug);
  if (existing.status === 'archived')
    reject(409, 'archived', 'Archived polls cannot change.');
  if (existing.status === 'published') return updatePublished(db, p, now);
  const result = await db.batch([
    db
      .prepare(
        `UPDATE polls SET title=?,description=?,identity_mode=?,min_selections=?,max_selections=?,allow_write_ins=?,results_visibility=?,starts_at=?,ends_at=?,allow_edits=?,edit_deadline=?,eligible_tags=?,updated_at=? WHERE slug=? AND status='draft'`,
      )
      .bind(...values(p), now, slug),
    ...draftChildren(db, p),
    ...replaceEmailAllowlist(db, slug, p.eligibleEmails, now, 'draft'),
  ]);
  if (result[0]!.meta.changes !== 1)
    reject(409, 'changed', 'Poll status changed. Read it again.');
  return adminDetail(db, slug);
}
async function updatePublished(db: D1Database, p: PollInput, now: string) {
  const current = await definition(db, await getPoll(db, p.slug));
  const frozen = (input: PollInput) =>
    JSON.stringify({
      ...input,
      title: '',
      description: '',
      options: input.options.map(optionValue),
      eligibleTags: [...input.eligibleTags].sort(),
      eligibleEmails: [],
    });
  if (frozen(current) !== frozen(p))
    reject(
      409,
      'frozen',
      'Only title, description and explicit eligibility can change after publication.',
    );
  const result = await db.batch([
    db
      .prepare(
        "UPDATE polls SET title=?,description=?,updated_at=? WHERE slug=? AND status='published'",
      )
      .bind(p.title, p.description, now, p.slug),
    ...replaceEmailAllowlist(db, p.slug, p.eligibleEmails, now, 'published'),
  ]);
  if (result[0]!.meta.changes !== 1)
    reject(409, 'changed', 'Poll status changed. Read it again.');
  return adminDetail(db, p.slug);
}
