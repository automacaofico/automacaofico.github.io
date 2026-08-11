CREATE TABLE permissive_monthly_sequences (
  month TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL
);

CREATE TABLE permissive_authorizations (
  id TEXT PRIMARY KEY,
  sequence_number INTEGER NOT NULL,
  sequence_month TEXT NOT NULL,
  permanent_code TEXT NOT NULL UNIQUE,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operator_registration TEXT REFERENCES operators(registration),
  line_id TEXT NOT NULL REFERENCES track_lines(id),
  km_start REAL NOT NULL,
  km_end REAL NOT NULL,
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  speed_limit_kmh INTEGER NOT NULL DEFAULT 15 CHECK (speed_limit_kmh = 15),
  work_description TEXT NOT NULL,
  justification TEXT NOT NULL,
  communication_channel TEXT NOT NULL CHECK (communication_channel IN ('radio','whatsapp')),
  communication_confirmed INTEGER NOT NULL CHECK (communication_confirmed = 1),
  status TEXT NOT NULL CHECK (status IN ('active','completed','cancelled')) DEFAULT 'active',
  authorized_by_controller TEXT NOT NULL REFERENCES cco_controllers(code),
  authorized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  completed_by_controller TEXT REFERENCES cco_controllers(code),
  completion_note TEXT,
  cancelled_at TEXT,
  cancelled_by_controller TEXT REFERENCES cco_controllers(code),
  cancel_reason TEXT,
  UNIQUE(sequence_month,sequence_number)
);

CREATE TABLE permissive_links (
  permission_id TEXT NOT NULL REFERENCES permissive_authorizations(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('LDL','CIRC')),
  record_id TEXT NOT NULL,
  PRIMARY KEY (permission_id,record_kind,record_id)
);

CREATE TABLE permissive_events (
  id TEXT PRIMARY KEY,
  permission_id TEXT NOT NULL REFERENCES permissive_authorizations(id),
  event_type TEXT NOT NULL,
  controller_code TEXT NOT NULL REFERENCES cco_controllers(code),
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX idx_permissive_status_time ON permissive_authorizations(status,planned_start,planned_end);
CREATE INDEX idx_permissive_line_km ON permissive_authorizations(line_id,km_start,km_end);
CREATE INDEX idx_permissive_links_record ON permissive_links(record_kind,record_id);
