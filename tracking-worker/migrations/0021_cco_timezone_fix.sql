-- Registros anteriores eram recebidos como datetime-local de Fortaleza, mas
-- interpretados pelo Worker como UTC. Corrige somente os horários operacionais;
-- created_at/authorized_at/occurred_at já representam instantes UTC corretos.
UPDATE ldl
SET requested_start = strftime('%Y-%m-%dT%H:%M:%fZ', requested_start, '+3 hours'),
    requested_end = strftime('%Y-%m-%dT%H:%M:%fZ', requested_end, '+3 hours');

UPDATE circulations
SET planned_start = strftime('%Y-%m-%dT%H:%M:%fZ', planned_start, '+3 hours'),
    planned_end = strftime('%Y-%m-%dT%H:%M:%fZ', planned_end, '+3 hours');

UPDATE permissive_authorizations
SET planned_start = strftime('%Y-%m-%dT%H:%M:%fZ', planned_start, '+3 hours'),
    planned_end = strftime('%Y-%m-%dT%H:%M:%fZ', planned_end, '+3 hours');

UPDATE ldl_events
SET payload_json = json_set(
  payload_json,
  '$.after.start', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.after.start'), '+3 hours'),
  '$.after.end', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.after.end'), '+3 hours')
)
WHERE json_valid(payload_json)
  AND json_extract(payload_json, '$.after.start') IS NOT NULL
  AND json_extract(payload_json, '$.after.end') IS NOT NULL;

UPDATE ldl_events
SET payload_json = json_set(
  payload_json,
  '$.before.start', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.before.start'), '+3 hours'),
  '$.before.end', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.before.end'), '+3 hours')
)
WHERE json_valid(payload_json)
  AND json_extract(payload_json, '$.before.start') IS NOT NULL
  AND json_extract(payload_json, '$.before.end') IS NOT NULL;

UPDATE circulation_events
SET payload_json = json_set(
  payload_json,
  '$.after.start', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.after.start'), '+3 hours'),
  '$.after.end', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.after.end'), '+3 hours')
)
WHERE json_valid(payload_json)
  AND json_extract(payload_json, '$.after.start') IS NOT NULL
  AND json_extract(payload_json, '$.after.end') IS NOT NULL;

UPDATE circulation_events
SET payload_json = json_set(
  payload_json,
  '$.before.start', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.before.start'), '+3 hours'),
  '$.before.end', strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload_json, '$.before.end'), '+3 hours')
)
WHERE json_valid(payload_json)
  AND json_extract(payload_json, '$.before.start') IS NOT NULL
  AND json_extract(payload_json, '$.before.end') IS NOT NULL;
