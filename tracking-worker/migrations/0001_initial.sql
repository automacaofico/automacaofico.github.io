CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('locomotiva', 'socadora', 'reguladora', 'ntc')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  bearing_deg REAL,
  altitude_m REAL,
  battery_pct INTEGER,
  sequence_no INTEGER,
  UNIQUE(equipment_id, captured_at, sequence_no)
);

CREATE INDEX idx_positions_equipment_time
  ON positions(equipment_id, captured_at DESC);

CREATE TABLE latest_positions (
  equipment_id TEXT PRIMARY KEY REFERENCES equipment(id),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  bearing_deg REAL,
  altitude_m REAL,
  battery_pct INTEGER,
  sequence_no INTEGER
);

INSERT INTO equipment (id, name, type) VALUES
  ('LOCO001', 'Locomotiva 001', 'locomotiva'),
  ('LOCO002', 'Locomotiva 002', 'locomotiva'),
  ('LOCO003', 'Locomotiva 003', 'locomotiva'),
  ('LOCO004', 'Locomotiva 004', 'locomotiva'),
  ('LOCO005', 'Locomotiva 005', 'locomotiva'),
  ('LOCO006', 'Locomotiva 006', 'locomotiva'),
  ('LOCO007', 'Locomotiva 007', 'locomotiva'),
  ('EGPS001', 'Socadora 001', 'socadora'),
  ('EGPS002', 'Socadora 002', 'socadora'),
  ('EGPS003', 'Socadora 003', 'socadora'),
  ('EGPR001', 'Reguladora 001', 'reguladora'),
  ('EGPR002', 'Reguladora 002', 'reguladora'),
  ('EGPR003', 'Reguladora 003', 'reguladora'),
  ('NTC001', 'NTC 001', 'ntc');
