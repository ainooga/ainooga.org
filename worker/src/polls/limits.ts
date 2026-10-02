export const WRITE_INS_PER_PERSON = 1;
export const OPTIONS_PER_POLL = 500;

// Correlated with the poll (p) and authenticated person (s) in the ballot claim.
// Existing labels are reusable even when either creation limit has been reached.
export const writeInAllowed = `(? IS NULL OR EXISTS (
  SELECT 1 FROM poll_options WHERE poll_id=p.id AND normalized_label=?)
  OR ((SELECT count(*) FROM poll_options WHERE poll_id=p.id
    AND origin='write_in' AND created_by_person_id=s.person_id)<${WRITE_INS_PER_PERSON}
    AND (SELECT count(*) FROM poll_options WHERE poll_id=p.id)<${OPTIONS_PER_POLL}))`;
