CREATE TABLE activation_codes (
  code_hash TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  installation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activation_codes_equipment ON activation_codes(equipment_id, expires_at);
