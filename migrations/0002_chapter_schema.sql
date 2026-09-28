-- Apply with the forms in maintenance mode; backfill using pnpm db:backfill.
-- Legacy tables are retained for reconciliation and recovery.
ALTER TABLE contact_requests RENAME TO legacy_contact_requests;

CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  company TEXT,
  professional_role TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE person_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'discord', 'phone', 'linkedin')),
  value TEXT NOT NULL CHECK (length(trim(value, char(9,10,11,12,13,32))) > 0),
  normalized_value TEXT NOT NULL CHECK (length(trim(normalized_value, char(9,10,11,12,13,32))) > 0),
  display_label TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, kind, normalized_value),
  UNIQUE (id, person_id)
);
CREATE UNIQUE INDEX idx_identifiers_voting ON person_identifiers(kind, normalized_value)
  WHERE kind IN ('email', 'discord');
CREATE INDEX idx_identifiers_contact ON person_identifiers(kind, normalized_value)
  WHERE kind IN ('phone', 'linkedin');

CREATE TABLE person_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source TEXT NOT NULL CHECK (length(trim(source, char(9,10,11,12,13,32))) > 0),
  source_key TEXT NOT NULL CHECK (length(trim(source_key, char(9,10,11,12,13,32))) > 0),
  first_imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, source_key),
  UNIQUE (id, person_id)
);
CREATE INDEX idx_person_sources_person ON person_sources(person_id);

CREATE TABLE memberships (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  joined_at TEXT,
  ended_at TEXT,
  source INTEGER NOT NULL,
  FOREIGN KEY (source, person_id) REFERENCES person_sources(id, person_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_memberships_status ON memberships(status, person_id);
CREATE INDEX idx_memberships_source ON memberships(source, person_id);

CREATE TABLE person_tags (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tag TEXT NOT NULL CHECK (length(trim(tag, char(9,10,11,12,13,32))) > 0 AND tag = lower(trim(tag))),
  PRIMARY KEY (person_id, tag)
);

CREATE INDEX idx_person_tags_tag ON person_tags(tag, person_id);
CREATE TABLE organizer_permissions (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  permission TEXT NOT NULL CHECK (permission IN ('polls:manage', 'members:import', 'ballots:read')),
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  granted_by INTEGER REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at TEXT,
  PRIMARY KEY (person_id, permission)
);
CREATE INDEX idx_permissions_granter ON organizer_permissions(granted_by);

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name, char(9,10,11,12,13,32))) > 0),
  website TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE organization_people (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('contact', 'employee', 'representative')),
  PRIMARY KEY (organization_id, person_id, relationship)
);
CREATE INDEX idx_organization_people_person ON organization_people(person_id, organization_id);

CREATE TABLE sponsorships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tier TEXT NOT NULL CHECK (tier IN ('platinum', 'gold', 'silver', 'bronze', 'community')),
  starts_at TEXT,
  ends_at TEXT,
  CHECK ((organization_id IS NULL) <> (person_id IS NULL)),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX idx_sponsorships_organization ON sponsorships(organization_id);
CREATE INDEX idx_sponsorships_person ON sponsorships(person_id);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  email_identifier_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('newsletter', 'event_invites')),
  status TEXT NOT NULL CHECK (status IN ('unknown', 'pending', 'confirmed', 'unsubscribed')),
  confirmation_token_hash TEXT UNIQUE,
  confirmation_expires_at TEXT,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  source TEXT DEFAULT 'website',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, kind),
  FOREIGN KEY (email_identifier_id, person_id) REFERENCES person_identifiers(id, person_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_subscriptions_email ON subscriptions(email_identifier_id, person_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(kind, status);

CREATE TABLE contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  submitted_name TEXT NOT NULL,
  submitted_phone TEXT NOT NULL,
  preferred_date TEXT,
  preferred_time TEXT,
  source TEXT DEFAULT 'sponsor',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_contact_requests_person ON contact_requests(person_id);
CREATE INDEX idx_contact_requests_source_created ON contact_requests(source, created_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name, char(9,10,11,12,13,32))) > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT CHECK (ends_at > starts_at),
  timezone TEXT,
  location TEXT,
  capacity INTEGER CHECK (capacity IS NULL OR (typeof(capacity) = 'integer' AND capacity >= 0)),
  ainooga_url TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE event_links (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  platform TEXT NOT NULL CHECK (length(trim(platform, char(9,10,11,12,13,32))) > 0),
  external_id TEXT,
  url TEXT NOT NULL CHECK (length(trim(url, char(9,10,11,12,13,32))) > 0),
  PRIMARY KEY (event_id, platform),
  UNIQUE (platform, external_id)
);
CREATE TABLE event_participation (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  registration_status TEXT CHECK (registration_status IN ('invited', 'approved', 'pending_approval', 'declined', 'waitlist', 'cancelled')),
  attendance_status TEXT NOT NULL DEFAULT 'unknown' CHECK (attendance_status IN ('unknown', 'attended', 'absent')),
  registered_at TEXT,
  checked_in_at TEXT,
  source TEXT NOT NULL CHECK (length(trim(source, char(9,10,11,12,13,32))) > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, person_id),
  CHECK (checked_in_at IS NULL OR attendance_status = 'attended')
);
CREATE INDEX idx_participation_person ON event_participation(person_id, event_id);
CREATE INDEX idx_participation_registration ON event_participation(event_id, registration_status);

CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (length(trim(slug, char(9,10,11,12,13,32))) > 0),
  title TEXT NOT NULL CHECK (length(trim(title, char(9,10,11,12,13,32))) > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  identity_mode TEXT NOT NULL CHECK (identity_mode IN ('honor', 'verified')),
  min_selections INTEGER NOT NULL CHECK (typeof(min_selections) = 'integer' AND min_selections >= 1),
  max_selections INTEGER CHECK (max_selections IS NULL OR (typeof(max_selections) = 'integer' AND max_selections >= min_selections)),
  allow_write_ins INTEGER NOT NULL DEFAULT 0 CHECK (allow_write_ins IN (0, 1)),
  results_visibility TEXT NOT NULL CHECK (results_visibility IN ('before_vote', 'after_vote', 'never')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  allow_edits INTEGER NOT NULL DEFAULT 0 CHECK (allow_edits IN (0, 1)),
  edit_deadline TEXT,
  created_by INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (edit_deadline IS NULL OR (allow_edits = 1 AND edit_deadline > starts_at AND edit_deadline <= ends_at))
);
CREATE INDEX idx_polls_creator ON polls(created_by);
CREATE INDEX idx_polls_schedule ON polls(status, starts_at, ends_at);

CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  label TEXT NOT NULL CHECK (length(trim(label, char(9,10,11,12,13,32))) > 0),
  normalized_label TEXT NOT NULL CHECK (length(trim(normalized_label, char(9,10,11,12,13,32))) > 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (typeof(position) = 'integer' AND position >= 0),
  origin TEXT NOT NULL CHECK (origin IN ('predefined', 'write_in')),
  created_by_person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (poll_id, normalized_label),
  UNIQUE (id, poll_id),
  CHECK (origin <> 'write_in' OR created_by_person_id IS NOT NULL)
);
CREATE INDEX idx_options_creator ON poll_options(created_by_person_id);
CREATE INDEX idx_options_order ON poll_options(poll_id, position, id);

CREATE TABLE poll_allowlist (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  PRIMARY KEY (poll_id, person_id)
);
CREATE INDEX idx_allowlist_person ON poll_allowlist(person_id, poll_id);
CREATE TABLE poll_ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  UNIQUE (poll_id, person_id),
  UNIQUE (id, poll_id),
  FOREIGN KEY (poll_id, person_id) REFERENCES poll_allowlist(poll_id, person_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE poll_ballot_choices (
  ballot_id INTEGER NOT NULL,
  poll_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  PRIMARY KEY (ballot_id, option_id),
  FOREIGN KEY (ballot_id, poll_id) REFERENCES poll_ballots(id, poll_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (option_id, poll_id) REFERENCES poll_options(id, poll_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_choices_option ON poll_ballot_choices(option_id, poll_id);
