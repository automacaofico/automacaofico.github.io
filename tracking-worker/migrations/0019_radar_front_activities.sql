CREATE TABLE IF NOT EXISTS radar_front_activities (
  front_id TEXT NOT NULL,
  activity_id TEXT,
  activity_name TEXT NOT NULL,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (front_id, sequence_order),
  FOREIGN KEY (front_id) REFERENCES radar_fronts(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES radar_activities(id)
);

CREATE INDEX IF NOT EXISTS idx_radar_front_activities_front
  ON radar_front_activities(front_id);

INSERT OR IGNORE INTO radar_front_activities (front_id, activity_id, activity_name, sequence_order)
SELECT id, activity_id, activity_name, 0
FROM radar_fronts
WHERE TRIM(COALESCE(activity_name, '')) <> '';
