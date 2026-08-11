ALTER TABLE ldl ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ldl ADD COLUMN updated_at TEXT;
ALTER TABLE ldl ADD COLUMN updated_by_controller TEXT REFERENCES cco_controllers(code);

CREATE INDEX IF NOT EXISTS idx_ldl_events_ldl_time ON ldl_events(ldl_id,occurred_at DESC);
