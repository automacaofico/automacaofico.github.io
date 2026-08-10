CREATE TABLE personal_devices (
  id TEXT PRIMARY KEY,
  operator_registration TEXT NOT NULL REFERENCES operators(registration),
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  label TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT,
  token_iv TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT
);

CREATE INDEX idx_personal_devices_operator
  ON personal_devices(operator_registration, active, created_at DESC);

UPDATE operator_sessions
SET ended_at = CURRENT_TIMESTAMP, ended_reason = 'consolidado na migração v2'
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY operator_registration ORDER BY started_at DESC, id DESC) AS position
    FROM operator_sessions WHERE ended_at IS NULL
  ) WHERE position > 1
);

CREATE UNIQUE INDEX idx_operator_sessions_active_operator
  ON operator_sessions(operator_registration) WHERE ended_at IS NULL;

ALTER TABLE positions ADD COLUMN operator_registration TEXT REFERENCES operators(registration);
ALTER TABLE positions ADD COLUMN device_id TEXT REFERENCES personal_devices(id);
ALTER TABLE latest_positions ADD COLUMN operator_registration TEXT REFERENCES operators(registration);
ALTER TABLE latest_positions ADD COLUMN device_id TEXT REFERENCES personal_devices(id);

CREATE TABLE position_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_minute TEXT NOT NULL,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operator_registration TEXT REFERENCES operators(registration),
  device_id TEXT REFERENCES personal_devices(id),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  bearing_deg REAL,
  altitude_m REAL,
  battery_pct INTEGER,
  UNIQUE(device_id, sample_minute)
);

CREATE INDEX idx_position_samples_equipment_time
  ON position_samples(equipment_id, captured_at DESC);
CREATE INDEX idx_position_samples_operator_time
  ON position_samples(operator_registration, captured_at DESC);

CREATE TABLE operation_session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES operator_sessions(id),
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operator_registration TEXT NOT NULL REFERENCES operators(registration),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  points_count INTEGER NOT NULL,
  moving_s INTEGER NOT NULL,
  stopped_s INTEGER NOT NULL,
  gps_distance_m REAL NOT NULL,
  avg_moving_speed_mps REAL,
  max_speed_mps REAL,
  calculated_at TEXT NOT NULL
);

CREATE INDEX idx_operation_summaries_equipment_time
  ON operation_session_summaries(equipment_id, started_at DESC);
CREATE INDEX idx_operation_summaries_operator_time
  ON operation_session_summaries(operator_registration, started_at DESC);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  session_id TEXT REFERENCES operator_sessions(id),
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operator_registration TEXT REFERENCES operators(registration),
  occurred_at TEXT NOT NULL,
  station_m REAL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_operational_events_equipment_time
  ON operational_events(equipment_id, occurred_at DESC);
