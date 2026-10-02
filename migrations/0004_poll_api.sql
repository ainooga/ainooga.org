-- Additive tables; keep existing chapter and authentication definitions unchanged.
CREATE TABLE poll_eligible_tags (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tag TEXT NOT NULL CHECK (length(trim(tag, char(9,10,11,12,13,32))) > 0 AND tag = lower(trim(tag))),
  PRIMARY KEY (poll_id, tag)
);

-- One latest receipt per voter. Claim before inserting the ballot within a batch.
CREATE TABLE poll_submission_receipts (
  poll_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  attempt_nonce TEXT NOT NULL CHECK (length(attempt_nonce) = 64),
  PRIMARY KEY (poll_id, person_id),
  FOREIGN KEY (poll_id, person_id) REFERENCES poll_allowlist(poll_id, person_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
