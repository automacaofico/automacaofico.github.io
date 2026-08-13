CREATE TABLE circulation_equipment_members (
  id TEXT PRIMARY KEY,
  circulation_id TEXT NOT NULL REFERENCES circulations(id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  operational_role TEXT NOT NULL CHECK (operational_role IN ('traction_auxiliary','towed')),
  UNIQUE (circulation_id, equipment_id),
  UNIQUE (circulation_id, sequence_order)
);

CREATE INDEX idx_circulation_members_equipment
  ON circulation_equipment_members(equipment_id, circulation_id);
