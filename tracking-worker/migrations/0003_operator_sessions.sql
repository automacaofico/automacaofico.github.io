CREATE TABLE operators (
  registration TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operator_registration TEXT NOT NULL REFERENCES operators(registration),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_operator_sessions_active_equipment
  ON operator_sessions(equipment_id) WHERE ended_at IS NULL;

CREATE INDEX idx_operator_sessions_equipment_time
  ON operator_sessions(equipment_id, started_at DESC);

CREATE INDEX idx_operator_sessions_operator_time
  ON operator_sessions(operator_registration, started_at DESC);
