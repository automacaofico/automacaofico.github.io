CREATE TABLE IF NOT EXISTS organogram_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organogram_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organogram_sessions_expiry
  ON organogram_sessions(expires_at);
