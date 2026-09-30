CREATE TABLE voter_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  identifier_id INTEGER NOT NULL,
  identifier_value TEXT NOT NULL,
  assurance TEXT NOT NULL CHECK (assurance IN ('honor', 'verified')),
  poll_id INTEGER REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (identifier_id, person_id) REFERENCES person_identifiers(id, person_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((assurance = 'honor' AND poll_id IS NOT NULL) OR (assurance = 'verified' AND poll_id IS NULL))
);
CREATE INDEX idx_voter_sessions_expiry ON voter_sessions(expires_at);
CREATE INDEX idx_voter_sessions_identifier ON voter_sessions(identifier_id, person_id);
CREATE INDEX idx_voter_sessions_poll ON voter_sessions(poll_id);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'discord')),
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  identifier_id INTEGER REFERENCES person_identifiers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  identifier_value TEXT,
  browser_hash TEXT NOT NULL,
  proof_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  CHECK ((kind = 'email' AND identifier_id IS NOT NULL AND identifier_value IS NOT NULL AND proof_hash IS NOT NULL) OR kind = 'discord')
);
CREATE INDEX idx_auth_challenges_expiry ON auth_challenges(expires_at);
CREATE INDEX idx_auth_challenges_identifier ON auth_challenges(identifier_id, created_at);
CREATE INDEX idx_auth_challenges_poll ON auth_challenges(poll_id);
