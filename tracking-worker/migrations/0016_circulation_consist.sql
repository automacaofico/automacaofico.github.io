CREATE TABLE circulation_consist (
  id TEXT PRIMARY KEY,
  circulation_id TEXT NOT NULL REFERENCES circulations(id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL,
  wagon_type TEXT NOT NULL CHECK (wagon_type IN ('HNS','HNT','PET','PNT','PES')),
  wagon_count INTEGER NOT NULL CHECK (wagon_count > 0 AND wagon_count <= 500),
  load_status TEXT NOT NULL CHECK (load_status IN ('loaded','empty')),
  cargo_description TEXT,
  UNIQUE (circulation_id, sequence_order)
);

CREATE INDEX idx_circulation_consist_circulation
  ON circulation_consist(circulation_id, sequence_order);
