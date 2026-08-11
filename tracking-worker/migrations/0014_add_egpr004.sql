INSERT INTO equipment (id,name,type,description,active)
VALUES ('EGPR004','Reguladora 004','reguladora',NULL,1)
ON CONFLICT(id) DO UPDATE SET type='reguladora',active=1;
