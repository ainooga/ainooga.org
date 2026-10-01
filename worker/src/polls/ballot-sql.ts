import { sessionFrom, sessionWhere } from './access.js';
import type { BallotInput } from './schemas.js';

export interface Submission {
  pollId: number;
  personId: number;
  sessionHash: string;
  now: string;
  nonce: string;
  payloadHash: string;
  input: BallotInput;
  normalized: string | null;
}
const receiptGuard = `EXISTS (SELECT 1 FROM poll_submission_receipts WHERE poll_id=? AND person_id=? AND attempt_nonce=?)`;
const projectedSelections = `SELECT normalized_label AS label FROM poll_options WHERE poll_id=p.id AND id IN (SELECT value FROM json_each(?)) UNION SELECT ? WHERE ? IS NOT NULL`;
const claimSQL = `INSERT INTO poll_submission_receipts (poll_id,person_id,request_id,payload_hash,attempt_nonce)
  SELECT p.id,s.person_id,?,?,? ${sessionFrom}
  LEFT JOIN poll_ballots b ON b.poll_id=p.id AND b.person_id=s.person_id
  WHERE ${sessionWhere} AND s.person_id=? AND p.starts_at<=? AND p.ends_at>?
    AND (b.id IS NULL OR (p.allow_edits=1 AND coalesce(p.edit_deadline,p.ends_at)>?))
    AND coalesce(b.revision,0)=?
    AND (? IS NULL OR p.allow_write_ins=1)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM poll_options o WHERE o.id=j.value AND o.poll_id=p.id))
    AND (SELECT count(*) FROM (${projectedSelections}))>=p.min_selections
    AND (p.max_selections IS NULL OR (SELECT count(*) FROM (${projectedSelections}))<=p.max_selections)
  ON CONFLICT (poll_id,person_id) DO UPDATE SET request_id=excluded.request_id,payload_hash=excluded.payload_hash,attempt_nonce=excluded.attempt_nonce
    WHERE poll_submission_receipts.request_id!=excluded.request_id`;
export function claim(db: D1Database, s: Submission) {
  const ids = JSON.stringify(s.input.optionIds);
  const selectionArgs = [ids, s.normalized, s.normalized];
  return db
    .prepare(claimSQL)
    .bind(
      s.input.requestId,
      s.payloadHash,
      s.nonce,
      s.sessionHash,
      s.now,
      s.pollId,
      s.personId,
      s.now,
      s.now,
      s.now,
      s.input.expectedRevision,
      s.normalized,
      ids,
      ...selectionArgs,
      ...selectionArgs,
    );
}
export function mutateBallot(db: D1Database, s: Submission): D1PreparedStatement[] {
  const guard = [s.pollId, s.personId, s.nonce];
  return [
    db
      .prepare(
        `INSERT INTO poll_options (poll_id,label,normalized_label,position,origin,created_by_person_id,created_at)
      SELECT ?,?,?,coalesce((SELECT max(position)+1 FROM poll_options WHERE poll_id=?),0),'write_in',?,?
      WHERE ? IS NOT NULL AND ${receiptGuard} ON CONFLICT (poll_id,normalized_label) DO NOTHING`,
      )
      .bind(
        s.pollId,
        s.input.writeIn,
        s.normalized,
        s.pollId,
        s.personId,
        s.now,
        s.normalized,
        ...guard,
      ),
    db
      .prepare(
        `INSERT INTO poll_ballots (poll_id,person_id,submitted_at,updated_at,revision)
      SELECT ?,?,?,?,1 WHERE ${receiptGuard}
      ON CONFLICT (poll_id,person_id) DO UPDATE SET updated_at=excluded.updated_at,revision=poll_ballots.revision+1`,
      )
      .bind(s.pollId, s.personId, s.now, s.now, ...guard),
    db
      .prepare(
        `DELETE FROM poll_ballot_choices WHERE ballot_id IN (SELECT id FROM poll_ballots WHERE poll_id=? AND person_id=?) AND ${receiptGuard}`,
      )
      .bind(s.pollId, s.personId, ...guard),
    db
      .prepare(
        `INSERT INTO poll_ballot_choices (ballot_id,poll_id,option_id)
      SELECT b.id,b.poll_id,o.id FROM poll_ballots b JOIN poll_options o ON o.poll_id=b.poll_id
      WHERE b.poll_id=? AND b.person_id=? AND ${receiptGuard}
        AND (o.id IN (SELECT value FROM json_each(?)) OR o.normalized_label=?)`,
      )
      .bind(
        s.pollId,
        s.personId,
        ...guard,
        JSON.stringify(s.input.optionIds),
        s.normalized,
      ),
  ];
}
