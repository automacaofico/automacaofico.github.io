CREATE TABLE IF NOT EXISTS socaria_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
