-- Mailing list subscribers
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT DEFAULT 'website',
  created_at TEXT DEFAULT (datetime('now')),
  confirmed INTEGER DEFAULT 0,
  confirmation_token TEXT,
  confirmed_at TEXT
);

-- Contact / sponsor inquiries
CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  preferred_date TEXT,
  preferred_time TEXT,
  source TEXT DEFAULT 'sponsor',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirmed ON subscribers(confirmed);
CREATE INDEX IF NOT EXISTS idx_contact_requests_source ON contact_requests(source);
