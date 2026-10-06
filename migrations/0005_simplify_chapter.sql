-- Run through pnpm cf:migrate so legacy reconciliation happens before removal.
-- These guards also stop a direct migration from dropping unreconciled records.
CREATE TABLE simplification_guard (reconciled INTEGER NOT NULL CHECK (reconciled = 1));
INSERT INTO simplification_guard SELECT NOT EXISTS (
  SELECT 1 FROM subscribers old WHERE NOT EXISTS (
    SELECT 1 FROM person_sources s JOIN person_identifiers i ON i.person_id=s.person_id
    JOIN subscriptions sub ON sub.person_id=s.person_id AND sub.kind='newsletter'
    WHERE s.source='legacy_subscribers' AND s.source_key=CAST(old.id AS TEXT)
      AND i.kind='email' AND i.normalized_value=lower(trim(old.email))
  )
);
INSERT INTO simplification_guard SELECT NOT EXISTS (
  SELECT 1 FROM legacy_contact_requests old WHERE NOT EXISTS (
    SELECT 1 FROM contact_requests c WHERE c.id=old.id
      AND c.submitted_name=old.name AND c.submitted_phone=old.phone
      AND c.preferred_date IS old.preferred_date AND c.preferred_time IS old.preferred_time
      AND c.source IS old.source
  )
);
INSERT INTO simplification_guard SELECT NOT EXISTS (
  SELECT 1 FROM poll_submission_receipts r WHERE NOT EXISTS (
    SELECT 1 FROM poll_ballots b WHERE b.poll_id=r.poll_id AND b.person_id=r.person_id
  )
);
DROP TABLE simplification_guard;

INSERT INTO person_tags(person_id,tag)
  SELECT person_id,'member' FROM memberships
  UNION SELECT person_id,'member' FROM event_participation
    WHERE registration_status IS NOT NULL AND registration_status!='invited'
  ON CONFLICT(person_id,tag) DO NOTHING;

CREATE UNIQUE INDEX idx_organizations_name ON organizations(lower(trim(name)));
INSERT INTO organizations(name)
  SELECT trim(company) FROM people WHERE company IS NOT NULL AND trim(company)!=''
  GROUP BY lower(trim(company))
  ON CONFLICT DO NOTHING;
INSERT INTO organization_people(organization_id,person_id,relationship)
  SELECT o.id,p.id,'employee' FROM people p JOIN organizations o
    ON lower(trim(o.name))=lower(trim(p.company))
  WHERE p.company IS NOT NULL AND trim(p.company)!=''
  ON CONFLICT DO NOTHING;
ALTER TABLE people DROP COLUMN company;
DROP TABLE memberships;
DROP TABLE organizer_permissions;

ALTER TABLE polls ADD COLUMN eligible_tags TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(eligible_tags) AND json_type(eligible_tags)='array');
ALTER TABLE polls ADD COLUMN allowed_person_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(allowed_person_ids) AND json_type(allowed_person_ids)='array');
UPDATE polls SET eligible_tags=(SELECT json_group_array(tag) FROM (
  SELECT tag FROM poll_eligible_tags WHERE poll_id=polls.id ORDER BY tag
));
UPDATE polls SET allowed_person_ids=(SELECT json_group_array(person_id) FROM (
  SELECT a.person_id FROM poll_allowlist a WHERE a.poll_id=polls.id AND a.revoked_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM person_tags t JOIN json_each(polls.eligible_tags) j ON j.value=t.tag
      WHERE t.person_id=a.person_id)
  ORDER BY a.person_id
));
ALTER TABLE poll_options ADD COLUMN description TEXT
  CHECK (description IS NULL OR length(description)<=1000);

CREATE TABLE poll_ballots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision)='integer' AND revision>=1),
  request_id TEXT,
  payload_hash TEXT,
  attempt_nonce TEXT,
  UNIQUE (poll_id,person_id),
  UNIQUE (id,poll_id),
  CHECK ((request_id IS NULL AND payload_hash IS NULL AND attempt_nonce IS NULL)
    OR (request_id IS NOT NULL AND payload_hash IS NOT NULL AND attempt_nonce IS NOT NULL
      AND length(payload_hash)=64 AND length(attempt_nonce)=64))
);
INSERT INTO poll_ballots_new
  SELECT b.id,b.poll_id,b.person_id,b.submitted_at,b.updated_at,b.revision,
    r.request_id,r.payload_hash,r.attempt_nonce
  FROM poll_ballots b LEFT JOIN poll_submission_receipts r
    ON r.poll_id=b.poll_id AND r.person_id=b.person_id;
-- Remove the child before replacing its parent, without disabling foreign keys.
CREATE TABLE simplification_choices AS SELECT * FROM poll_ballot_choices;
DROP TABLE poll_ballot_choices;
DROP TABLE poll_ballots;
ALTER TABLE poll_ballots_new RENAME TO poll_ballots;
CREATE TABLE poll_ballot_choices (
  ballot_id INTEGER NOT NULL,
  poll_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  PRIMARY KEY (ballot_id,option_id),
  FOREIGN KEY (ballot_id,poll_id) REFERENCES poll_ballots(id,poll_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (option_id,poll_id) REFERENCES poll_options(id,poll_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
INSERT INTO poll_ballot_choices SELECT * FROM simplification_choices;
DROP TABLE simplification_choices;
CREATE INDEX idx_choices_option ON poll_ballot_choices(option_id,poll_id);
DROP TABLE poll_submission_receipts;
DROP TABLE poll_allowlist;
DROP TABLE poll_eligible_tags;
DROP TABLE subscribers;
DROP TABLE legacy_contact_requests;

CREATE VIEW events_with_counts AS
  SELECT e.*,(SELECT count(*) FROM event_participation ep
    WHERE ep.event_id=e.id AND ep.registration_status='approved') AS registered
  FROM events e;
