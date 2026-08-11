CREATE TABLE safety_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('LDL_INTRUSION')),
  severity TEXT NOT NULL CHECK (severity IN ('critical')) DEFAULT 'critical',
  status TEXT NOT NULL CHECK (status IN ('active','resolved')) DEFAULT 'active',
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  ldl_id TEXT NOT NULL REFERENCES ldl(id),
  captured_at TEXT NOT NULL,
  station_m REAL NOT NULL,
  distance_to_axis_m REAL NOT NULL,
  accuracy_m REAL,
  speed_kmh REAL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  detected_by_controller TEXT NOT NULL REFERENCES cco_controllers(code),
  occurrences INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_safety_events_active_key ON safety_events(event_key) WHERE status='active';
CREATE INDEX idx_safety_events_status_time ON safety_events(status,last_seen_at DESC);
CREATE INDEX idx_safety_events_equipment_time ON safety_events(equipment_id,first_seen_at DESC);
CREATE INDEX idx_safety_events_ldl_time ON safety_events(ldl_id,first_seen_at DESC);
