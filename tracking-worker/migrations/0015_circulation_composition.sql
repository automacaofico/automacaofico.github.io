ALTER TABLE circulations ADD COLUMN helper_equipment_id TEXT REFERENCES equipment(id);
ALTER TABLE circulations ADD COLUMN wagon_type TEXT CHECK (wagon_type IN ('HNS','HNT','PET','PNT','PES'));
ALTER TABLE circulations ADD COLUMN wagon_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE circulations ADD COLUMN load_status TEXT CHECK (load_status IN ('loaded','empty'));
ALTER TABLE circulations ADD COLUMN cargo_description TEXT;
CREATE INDEX idx_circulations_helper ON circulations(helper_equipment_id,status,planned_start,planned_end);
