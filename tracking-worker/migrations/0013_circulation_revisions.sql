ALTER TABLE circulations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE circulations ADD COLUMN revision_token TEXT;
ALTER TABLE circulations ADD COLUMN updated_at TEXT;
ALTER TABLE circulations ADD COLUMN updated_by_controller TEXT REFERENCES cco_controllers(code);
