CREATE TABLE member_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_run_at INTEGER NOT NULL DEFAULT 0,
  last_finished_at INTEGER,
  last_error TEXT,
  started_at INTEGER,
  roster TEXT CHECK (roster IS NULL OR json_valid(roster)),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  session_ciphertext TEXT
);
INSERT INTO member_sync_state(id) VALUES(1);
