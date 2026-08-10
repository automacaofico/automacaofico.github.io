import { normalizeOperatorName, normalizeOperatorPin, normalizeOwnTracksLocation, normalizePosition, normalizeRegistration, ownTracksEquipmentId, publicEquipmentId, validatePosition } from './validation.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function cors(request) {
  const origin = request.headers.get('origin');
  const allowed = !origin || origin === 'https://automacaofico.github.io' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed && origin ? origin : 'https://automacaofico.github.io',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function reply(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(request), ...extra } });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createDeviceToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytesLength = 18) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function operatorPinHash(salt, pin) {
  return sha256(`${salt}:${pin}`);
}

async function authenticatedOperator(env, registrationValue, pinValue) {
  const registration = normalizeRegistration(registrationValue);
  const pin = normalizeOperatorPin(pinValue);
  if (!registration || !pin) return null;
  const operator = await env.DB.prepare('SELECT registration,name,pin_salt,pin_hash FROM operators WHERE registration=? AND active=1').bind(registration).first();
  if (!operator) return null;
  const hash = await operatorPinHash(operator.pin_salt, pin);
  return hash === operator.pin_hash ? operator : null;
}

async function authenticate(request, env) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const hash = await sha256(match[1]);
  return env.DB.prepare('SELECT equipment_id FROM devices WHERE token_hash = ? AND active = 1').bind(hash).first();
}

async function authenticateOwnTracks(request, env) {
  const match = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  let decoded;
  try { decoded = atob(match[1]); } catch { return null; }
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  const equipmentId = ownTracksEquipmentId(decoded.slice(0, separator));
  const password = decoded.slice(separator + 1);
  if (!equipmentId || !password) return null;
  const hash = await sha256(password);
  const device = await env.DB.prepare('SELECT equipment_id FROM devices WHERE equipment_id = ? AND token_hash = ? AND active = 1').bind(equipmentId, hash).first();
  return device?.equipment_id === equipmentId ? device : null;
}

function statusFor(receivedAt) {
  if (!receivedAt) return 'sem_sinal';
  const age = Date.now() - Date.parse(receivedAt);
  if (age <= 30_000) return 'online';
  if (age <= 120_000) return 'instavel';
  return 'offline';
}

function serialize(row) {
  if (!row) return null;
  return {
    equipmentId: row.equipment_id,
    name: row.name,
    type: row.type,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    speedMps: row.speed_mps,
    bearingDeg: row.bearing_deg,
    altitudeM: row.altitude_m,
    batteryPct: row.battery_pct,
    sequenceNo: row.sequence_no,
    status: statusFor(row.received_at),
    operatorName: row.operator_name || null,
    operatorRegistration: row.operator_registration || null,
    shiftStartedAt: row.shift_started_at || null
  };
}

function publicSession(row) {
  if (!row) return null;
  return {
    sessionId: row.id,
    equipmentId: row.equipment_id,
    operatorName: row.operator_name,
    operatorRegistration: row.operator_registration,
    startedAt: row.started_at
  };
}

async function registerOperator(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!env.OPERATOR_ADMIN_PASSWORD || String(body.adminPassword || '') !== env.OPERATOR_ADMIN_PASSWORD) {
    return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  }
  const registration = normalizeRegistration(body.registration);
  const name = normalizeOperatorName(body.name);
  const pin = normalizeOperatorPin(body.pin);
  if (!registration || !name || !pin) return reply(request, { ok: false, error: 'Informe nome, matrícula válida e PIN numérico de 4 a 8 dígitos.' }, 400);
  const salt = randomToken(16);
  const hash = await operatorPinHash(salt, pin);
  await env.DB.prepare(`INSERT INTO operators (registration,name,pin_salt,pin_hash,active,updated_at)
    VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(registration) DO UPDATE SET name=excluded.name,pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,active=1,updated_at=CURRENT_TIMESTAMP`)
    .bind(registration, name, salt, hash).run();
  return reply(request, { ok: true, operator: { registration, name } }, 201, { 'cache-control': 'no-store' });
}

async function activeOperatorSession(env, equipmentId) {
  return env.DB.prepare(`SELECT s.id,s.equipment_id,s.operator_registration,s.started_at,o.name AS operator_name
    FROM operator_sessions s JOIN operators o ON o.registration=s.operator_registration
    WHERE s.equipment_id=? AND s.ended_at IS NULL LIMIT 1`).bind(equipmentId).first();
}

async function getOperatorSession(request, env) {
  const equipmentId = publicEquipmentId(new URL(request.url).searchParams.get('equipmentId'));
  if (!equipmentId) return reply(request, { ok: false, error: 'Equipamento inválido.' }, 400);
  return reply(request, { ok: true, session: publicSession(await activeOperatorSession(env, equipmentId)) }, 200, { 'cache-control': 'no-store' });
}

async function startOperatorSession(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const equipmentId = publicEquipmentId(body.equipmentId);
  const operator = await authenticatedOperator(env, body.registration, body.pin);
  if (!equipmentId || !operator) return reply(request, { ok: false, error: 'Equipamento, matrícula ou PIN inválido.' }, 401);
  const current = await activeOperatorSession(env, equipmentId);
  if (current?.operator_registration === operator.registration) return reply(request, { ok: true, session: publicSession(current), alreadyActive: true }, 200, { 'cache-control': 'no-store' });
  if (current && body.force !== true) {
    return reply(request, { ok: false, error: 'Equipamento já possui um operador ativo.', conflict: publicSession(current) }, 409, { 'cache-control': 'no-store' });
  }
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const statements = [];
  if (current) statements.push(env.DB.prepare("UPDATE operator_sessions SET ended_at=?,ended_reason='substituído' WHERE id=? AND ended_at IS NULL").bind(now, current.id));
  statements.push(env.DB.prepare(`INSERT INTO operator_sessions (id,equipment_id,operator_registration,started_at)
    VALUES (?,?,?,?)`).bind(sessionId, equipmentId, operator.registration, now));
  await env.DB.batch(statements);
  return reply(request, { ok: true, session: { sessionId, equipmentId, operatorName: operator.name, operatorRegistration: operator.registration, startedAt: now } }, 201, { 'cache-control': 'no-store' });
}

async function endOperatorSession(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const equipmentId = publicEquipmentId(body.equipmentId);
  const operator = await authenticatedOperator(env, body.registration, body.pin);
  if (!equipmentId || !operator) return reply(request, { ok: false, error: 'Equipamento, matrícula ou PIN inválido.' }, 401);
  const result = await env.DB.prepare(`UPDATE operator_sessions SET ended_at=?,ended_reason='encerrado pelo operador'
    WHERE equipment_id=? AND operator_registration=? AND ended_at IS NULL`)
    .bind(new Date().toISOString(), equipmentId, operator.registration).run();
  if (!result.meta.changes) return reply(request, { ok: false, error: 'Não há turno ativo deste operador no equipamento.' }, 404);
  return reply(request, { ok: true }, 200, { 'cache-control': 'no-store' });
}

async function ingest(request, env) {
  const device = await authenticate(request, env);
  if (!device) return reply(request, { ok: false, error: 'Credencial inválida.' }, 401);
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const values = Array.isArray(body.positions) ? body.positions : [body];
  if (!values.length || values.length > 100) return reply(request, { ok: false, error: 'Envie de 1 a 100 posições.' }, 400);
  for (const value of values) {
    const error = validatePosition(value);
    if (error) return reply(request, { ok: false, error }, 400);
    if (value.equipmentId !== device.equipment_id) return reply(request, { ok: false, error: 'Credencial não corresponde ao equipamento.' }, 403);
  }
  const receivedAt = new Date().toISOString();
  const positions = values.map((value) => normalizePosition(value, receivedAt));
  const statements = [];
  for (const p of positions) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO positions
      (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(p.equipmentId,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracyM,p.speedMps,p.bearingDeg,p.altitudeM,p.batteryPct,p.sequenceNo));
  }
  const latest = [...positions].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  statements.push(env.DB.prepare(`INSERT INTO latest_positions
    (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(equipment_id) DO UPDATE SET
      captured_at=excluded.captured_at, received_at=excluded.received_at,
      latitude=excluded.latitude, longitude=excluded.longitude, accuracy_m=excluded.accuracy_m,
      speed_mps=excluded.speed_mps, bearing_deg=excluded.bearing_deg, altitude_m=excluded.altitude_m,
      battery_pct=excluded.battery_pct, sequence_no=excluded.sequence_no
    WHERE excluded.captured_at >= latest_positions.captured_at`).bind(latest.equipmentId,latest.capturedAt,latest.receivedAt,latest.latitude,latest.longitude,latest.accuracyM,latest.speedMps,latest.bearingDeg,latest.altitudeM,latest.batteryPct,latest.sequenceNo));
  await env.DB.batch(statements);
  return reply(request, { ok: true, accepted: positions.length, receivedAt }, 202);
}

async function ingestOwnTracks(request, env) {
  const device = await authenticateOwnTracks(request, env);
  if (!device) return reply(request, { ok: false, error: 'Credencial inválida.' }, 401, { 'www-authenticate': 'Basic realm="FICO OwnTracks"' });
  const raw = await request.text();
  if (!raw.trim()) return reply(request, [], 200);
  let payload;
  try { payload = JSON.parse(raw); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (payload?._type !== 'location') return reply(request, [], 200);
  const position = normalizeOwnTracksLocation(payload, device.equipment_id);
  const error = validatePosition(position);
  if (error) return reply(request, { ok: false, error }, 400);
  const receivedAt = new Date().toISOString();
  const p = normalizePosition(position, receivedAt);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO positions
      (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(p.equipmentId,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracyM,p.speedMps,p.bearingDeg,p.altitudeM,p.batteryPct,p.sequenceNo),
    env.DB.prepare(`INSERT INTO latest_positions
      (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(equipment_id) DO UPDATE SET
        captured_at=excluded.captured_at, received_at=excluded.received_at,
        latitude=excluded.latitude, longitude=excluded.longitude, accuracy_m=excluded.accuracy_m,
        speed_mps=excluded.speed_mps, bearing_deg=excluded.bearing_deg, altitude_m=excluded.altitude_m,
        battery_pct=excluded.battery_pct, sequence_no=excluded.sequence_no
      WHERE excluded.captured_at >= latest_positions.captured_at`).bind(p.equipmentId,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracyM,p.speedMps,p.bearingDeg,p.altitudeM,p.batteryPct,p.sequenceNo)
  ]);
  return reply(request, [], 200, { 'cache-control': 'no-store' });
}

async function activate(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const equipmentId = publicEquipmentId(body.equipmentId);
  const installationId = String(body.installationId || '');
  const activationCode = String(body.activationCode || '').trim().toUpperCase();
  if (!equipmentId || !/^[a-zA-Z0-9-]{16,80}$/.test(installationId) || !/^[A-Z0-9-]{8,24}$/.test(activationCode)) {
    return reply(request, { ok: false, error: 'Dados de ativação inválidos.' }, 400);
  }
  const codeHash = await sha256(activationCode);
  const consumed = await env.DB.prepare(`UPDATE activation_codes
    SET used_at=CURRENT_TIMESTAMP, installation_id=?
    WHERE code_hash=? AND equipment_id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP
    RETURNING equipment_id`).bind(installationId, codeHash, equipmentId).first();
  if (!consumed) return reply(request, { ok: false, error: 'Código inválido, expirado ou já utilizado.' }, 401);
  const token = createDeviceToken();
  const tokenHash = await sha256(token);
  await env.DB.prepare(`INSERT INTO devices (id,equipment_id,token_hash,active)
    VALUES (?,?,?,1)
    ON CONFLICT(id) DO UPDATE SET equipment_id=excluded.equipment_id,token_hash=excluded.token_hash,active=1`).bind(installationId, equipmentId, tokenHash).run();
  return reply(request, { ok: true, equipmentId, deviceToken: token }, 200, { 'cache-control': 'no-store' });
}

async function latest(request, env) {
  const rows = await env.DB.prepare(`SELECT e.id AS equipment_id,e.name,e.type,
    p.captured_at,p.received_at,p.latitude,p.longitude,p.accuracy_m,p.speed_mps,
    p.bearing_deg,p.altitude_m,p.battery_pct,p.sequence_no,
    o.name AS operator_name,s.operator_registration,s.started_at AS shift_started_at
    FROM equipment e LEFT JOIN latest_positions p ON p.equipment_id=e.id
    LEFT JOIN operator_sessions s ON s.equipment_id=e.id AND s.ended_at IS NULL
    LEFT JOIN operators o ON o.registration=s.operator_registration
    WHERE e.active=1 ORDER BY e.id`).all();
  return reply(request, { ok: true, serverTime: new Date().toISOString(), equipment: rows.results.map(serialize) }, 200, { 'cache-control': 'no-store' });
}

async function history(request, env, id) {
  const equipmentId = publicEquipmentId(id);
  if (!equipmentId) return reply(request, { ok: false, error: 'Equipamento inválido.' }, 400);
  const url = new URL(request.url);
  const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours')) || 24));
  const limit = Math.min(20_000, Math.max(1, Number(url.searchParams.get('limit')) || 5_000));
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = await env.DB.prepare(`SELECT equipment_id,captured_at,received_at,latitude,longitude,
    accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no
    FROM positions WHERE equipment_id=? AND captured_at>=?
    ORDER BY captured_at ASC LIMIT ?`).bind(equipmentId, since, limit).all();
  return reply(request, { ok: true, equipmentId, since, positions: rows.results.map(serialize) }, 200, { 'cache-control': 'public, max-age=5' });
}

async function route(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return reply(request, { ok: true, service: 'fico-tracking-api', time: new Date().toISOString() });
  if (request.method === 'POST' && url.pathname === '/api/v1/activate') return activate(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operators') return registerOperator(request, env);
  if (request.method === 'GET' && url.pathname === '/api/v1/operator/session') return getOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operator/session/start') return startOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operator/session/end') return endOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/positions') return ingest(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/owntracks') return ingestOwnTracks(request, env);
  if (request.method === 'GET' && url.pathname === '/api/v1/equipment/latest') return latest(request, env);
  const match = url.pathname.match(/^\/api\/v1\/equipment\/([^/]+)\/history$/);
  if (request.method === 'GET' && match) return history(request, env, decodeURIComponent(match[1]));
  return reply(request, { ok: false, error: 'Rota não encontrada.' }, 404);
}

export default {
  fetch: route,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(env.DB.prepare("DELETE FROM positions WHERE captured_at < datetime('now','-7 days')").run());
  }
};
