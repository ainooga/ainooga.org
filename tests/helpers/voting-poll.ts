// Seed only the open poll used by vote/write-in tests. Organizer setup has its own routes/tests.
export type VotingRules = {
  minSelections: number;
  maxSelections: number | null;
  allowWriteIns: boolean;
  resultsVisibility: 'before_vote' | 'after_vote' | 'never';
  allowEdits: boolean;
  editDeadline: string | null;
};

export async function seedVotingPoll(
  db: D1Database,
  overrides: Partial<VotingRules> = {},
) {
  const rules: VotingRules = {
    minSelections: 1,
    maxSelections: 1,
    allowWriteIns: true,
    resultsVisibility: 'after_vote',
    allowEdits: true,
    editDeadline: null,
    ...overrides,
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO polls (slug,title,status,identity_mode,min_selections,max_selections,
      allow_write_ins,results_visibility,starts_at,ends_at,allow_edits,edit_deadline,created_by,allowed_person_ids)
      VALUES ('topics','Next talk','published','honor',?,?,?,?,'2026-09-29T12:00:00.000Z',
      '2026-10-30T12:00:00.000Z',?,?,1,'[2]')`,
      )
      .bind(
        rules.minSelections,
        rules.maxSelections,
        Number(rules.allowWriteIns),
        rules.resultsVisibility,
        Number(rules.allowEdits),
        rules.editDeadline,
      ),
    db.prepare(`INSERT INTO poll_options (poll_id,label,normalized_label,position,origin)
      SELECT id,'Robotics','robotics',0,'predefined' FROM polls WHERE slug='topics'
      UNION ALL SELECT id,'Language models','language models',1,'predefined' FROM polls WHERE slug='topics'`),
  ]);
}
