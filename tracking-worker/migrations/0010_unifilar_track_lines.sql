INSERT OR IGNORE INTO track_lines (id,name,geometry_status) VALUES
  ('south_loop','Alça Sul','ready'),
  ('line_egp','Linha EGP','ready'),
  ('welding_yard','Estaleiro de Solda','ready');

UPDATE track_lines SET geometry_status='ready' WHERE id='line02';
