ALTER TABLE radar_fronts ADD COLUMN ldl_requirement TEXT
  CHECK (ldl_requirement IN ('required', 'not_required'));
