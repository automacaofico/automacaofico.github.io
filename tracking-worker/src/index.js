import { normalizePosition, publicEquipmentId, validatePosition } from './validation.js';

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

async function authenticate(request, env) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const hash = await sha256(match[1]);
  return env.DB.prepare('SELECT equipment_id FROM devices WHERE token_hash = ? AND active = 1').bind(hash).first();
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
    status: statusFor(row.received_at)
  };
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

async function latest(request, env) {
  const rows = await env.DB.prepare(`SELECT e.id AS equipment_id,e.name,e.type,
    p.captured_at,p.received_at,p.latitude,p.longitude,p.accuracy_m,p.speed_mps,
    p.bearing_deg,p.altitude_m,p.battery_pct,p.sequence_no
    FROM equipment e LEFT JOIN latest_positions p ON p.equipment_id=e.id
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
  if (request.method === 'POST' && url.pathname === '/api/v1/positions') return ingest(request, env);
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
