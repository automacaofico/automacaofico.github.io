import { normalizeOperatorName, normalizeOperatorPin, normalizeOwnTracksLocation, normalizePosition, normalizeRegistration, ownTracksEquipmentId, publicEquipmentId, validatePosition } from './validation.js';
import { summarizeGpsMovement } from './motion.js';
import { routeCco } from './cco.js';
import { routeRadar } from './radar.js';
import { routeOrganogram } from './organogram.js';
import { routeSocaria } from './socaria.js';
import { routeNtc } from './ntc.js';

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

function requestId() {
  return crypto.randomUUID();
}

function withRequestMetadata(response, id, startedAt) {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', id);
  headers.set('server-timing', `app;dur=${Math.max(0, Date.now() - startedAt)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function logRequestFailure(request, id, error) {
  const url = new URL(request.url);
  console.error(JSON.stringify({
    event: 'request_failed', requestId: id, method: request.method, path: url.pathname,
    message: error instanceof Error ? error.message : String(error),
  }));
}

async function readiness(request, env) {
  await env.DB.prepare('SELECT 1 AS ok').first();
  return reply(request, { ok: true, service: 'fico-tracking-api', database: 'ready', time: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
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

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function activationEncryptionKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fico-activation:${env.OPERATOR_ADMIN_PASSWORD}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptActivationCode(env, code) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await activationEncryptionKey(env), new TextEncoder().encode(code));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

async function decryptActivationCode(env, ciphertext, iv) {
  if (!ciphertext || !iv) return null;
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await activationEncryptionKey(env), fromBase64Url(ciphertext));
    return new TextDecoder().decode(decrypted);
  } catch { return null; }
}

function adminAuthorized(env, value) {
  return Boolean(env.OPERATOR_ADMIN_PASSWORD) && String(value || '') === env.OPERATOR_ADMIN_PASSWORD;
}

function historyResetAuthorized(env, value) {
  return Boolean(env.HISTORY_RESET_PASSWORD) && String(value || '') === env.HISTORY_RESET_PASSWORD;
}

function createActivationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const token = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `FICO-${token.slice(0, 4)}-${token.slice(4)}`;
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

function devicePlatform(value) {
  const platform = String(value || '').toLowerCase();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function deviceSuffix(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function ownTracksConfiguration(device, token) {
  return {
    _type: 'configuration', mode: 3, auth: true,
    url: 'https://fico-tracking-api.automacaofico.workers.dev/api/v2/owntracks',
    username: device.username, password: token, deviceId: device.id,
    clientId: device.id, tid: device.operator_registration.slice(-2).padStart(2, '0'),
    monitoring: 2, locatorInterval: 5, locatorDisplacement: 5,
    positions: 100, days: -1, extendedData: true
  };
}

async function authenticatePersonalBearer(request, env) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const hash = await sha256(match[1]);
  return env.DB.prepare(`SELECT id,operator_registration,platform,username FROM personal_devices
    WHERE token_hash=? AND active=1`).bind(hash).first();
}

async function authenticatePersonalOwnTracks(request, env) {
  const match = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  let decoded;
  try { decoded = atob(match[1]); } catch { return null; }
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const hash = await sha256(password);
  return env.DB.prepare(`SELECT id,operator_registration,platform,username FROM personal_devices
    WHERE username=? AND token_hash=? AND active=1`).bind(username, hash).first();
}

async function activeSessionForOperator(env, registration) {
  return env.DB.prepare(`SELECT s.id,s.equipment_id,s.operator_registration,s.started_at,o.name AS operator_name
    FROM operator_sessions s JOIN operators o ON o.registration=s.operator_registration
    WHERE s.operator_registration=? AND s.ended_at IS NULL LIMIT 1`).bind(registration).first();
}

function summarizePositionRows(rows, startedAt, endedAt) {
  const motion = summarizeGpsMovement(rows);
  return {
    durationS: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
    pointsCount: rows.length,
    movingS: Math.round(motion.movingS), stoppedS: Math.round(motion.stoppedS), gpsDistanceM: motion.distanceM,
    avgMovingSpeedMps: motion.avgMovingSpeedMps,
    maxSpeedMps: motion.maxSpeedMps
  };
}

async function finalizeSessionSummary(env, sessionId) {
  const session = await env.DB.prepare(`SELECT id,equipment_id,operator_registration,started_at,ended_at
    FROM operator_sessions WHERE id=? AND ended_at IS NOT NULL`).bind(sessionId).first();
  if (!session) return;
  const result = await env.DB.prepare(`SELECT captured_at,latitude,longitude,accuracy_m,speed_mps
    FROM positions WHERE equipment_id=? AND operator_registration=? AND captured_at>=? AND captured_at<=?
    ORDER BY captured_at`).bind(session.equipment_id, session.operator_registration, session.started_at, session.ended_at).all();
  const summary = summarizePositionRows(result.results, session.started_at, session.ended_at);
  await env.DB.prepare(`INSERT INTO operation_session_summaries
    (session_id,equipment_id,operator_registration,started_at,ended_at,duration_s,points_count,moving_s,stopped_s,gps_distance_m,avg_moving_speed_mps,max_speed_mps,calculated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET ended_at=excluded.ended_at,duration_s=excluded.duration_s,
      points_count=excluded.points_count,moving_s=excluded.moving_s,stopped_s=excluded.stopped_s,
      gps_distance_m=excluded.gps_distance_m,avg_moving_speed_mps=excluded.avg_moving_speed_mps,
      max_speed_mps=excluded.max_speed_mps,calculated_at=excluded.calculated_at`)
    .bind(session.id, session.equipment_id, session.operator_registration, session.started_at, session.ended_at,
      summary.durationS, summary.pointsCount, summary.movingS, summary.stoppedS, summary.gpsDistanceM,
      summary.avgMovingSpeedMps, summary.maxSpeedMps, new Date().toISOString()).run();
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
    description: row.description || '',
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
  if (!adminAuthorized(env, body.adminPassword)) {
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

async function createOperatorAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const registration = normalizeRegistration(body.registration);
  const name = normalizeOperatorName(body.name);
  const pin = normalizeOperatorPin(body.pin);
  if (!registration || !name || !pin) return reply(request, { ok: false, error: 'Informe nome, matrícula válida e PIN numérico de 4 a 8 dígitos.' }, 400);
  const exists = await env.DB.prepare('SELECT registration FROM operators WHERE registration=?').bind(registration).first();
  if (exists) return reply(request, { ok: false, error: 'Esta matrícula já está cadastrada. Use a opção Editar / PIN.' }, 409);
  const salt = randomToken(16);
  await env.DB.prepare(`INSERT INTO operators (registration,name,pin_salt,pin_hash,active,updated_at)
    VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)`).bind(registration, name, salt, await operatorPinHash(salt, pin)).run();
  return reply(request, { ok: true, operator: { registration, name } }, 201, { 'cache-control': 'no-store' });
}

async function listActivationCodes(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const rows = await env.DB.prepare(`SELECT code_hash,equipment_id,expires_at,used_at,installation_id,created_at,code_ciphertext,code_iv
    FROM activation_codes ORDER BY created_at DESC LIMIT 250`).all();
  const now = Date.now();
  const codes = [];
  for (const row of rows.results) {
    const status = row.used_at ? 'used' : Date.parse(row.expires_at) <= now ? 'expired' : 'active';
    codes.push({
      id: row.code_hash,
      equipmentId: row.equipment_id,
      code: status === 'active' ? await decryptActivationCode(env, row.code_ciphertext, row.code_iv) : null,
      status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      installationId: row.installation_id
    });
  }
  return reply(request, { ok: true, codes }, 200, { 'cache-control': 'no-store' });
}

async function generateActivationCode(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const equipmentId = publicEquipmentId(body.equipmentId);
  const validDays = Math.min(90, Math.max(1, Math.round(Number(body.validDays) || 30)));
  if (!equipmentId) return reply(request, { ok: false, error: 'Equipamento inválido.' }, 400);
  const code = createActivationCode();
  const codeHash = await sha256(code);
  const encrypted = await encryptActivationCode(env, code);
  const expiresAt = new Date(Date.now() + validDays * 86_400_000).toISOString();
  await env.DB.prepare(`INSERT INTO activation_codes (code_hash,equipment_id,expires_at,code_ciphertext,code_iv)
    VALUES (?,?,?,?,?)`).bind(codeHash, equipmentId, expiresAt, encrypted.ciphertext, encrypted.iv).run();
  return reply(request, { ok: true, activationCode: { id: codeHash, equipmentId, code, status: 'active', createdAt: new Date().toISOString(), expiresAt } }, 201, { 'cache-control': 'no-store' });
}

async function listOperatorsAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const rows = await env.DB.prepare(`SELECT o.registration,o.name,o.active,o.created_at,o.updated_at,
    (SELECT COUNT(*) FROM operator_sessions s WHERE s.operator_registration=o.registration) AS sessions_count,
    (SELECT s.equipment_id FROM operator_sessions s WHERE s.operator_registration=o.registration AND s.ended_at IS NULL LIMIT 1) AS active_equipment,
    (SELECT COUNT(*) FROM personal_devices d WHERE d.operator_registration=o.registration) AS devices_count,
    (SELECT COUNT(*) FROM personal_devices d WHERE d.operator_registration=o.registration AND d.active=1) AS active_devices_count,
    (SELECT MAX(d.last_seen_at) FROM personal_devices d WHERE d.operator_registration=o.registration) AS last_seen_at
    FROM operators o ORDER BY o.active DESC,o.name`).all();
  return reply(request, { ok: true, operators: rows.results.map((row) => ({
    registration: row.registration, name: row.name, active: Boolean(row.active), createdAt: row.created_at,
    updatedAt: row.updated_at, sessionsCount: Number(row.sessions_count), activeEquipment: row.active_equipment || null,
    devicesCount: Number(row.devices_count), activeDevicesCount: Number(row.active_devices_count), lastSeenAt: row.last_seen_at || null
  })) }, 200, { 'cache-control': 'no-store' });
}

async function updateOperatorAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const registration = normalizeRegistration(body.registration);
  const name = normalizeOperatorName(body.name);
  const pinProvided = String(body.pin || '').trim().length > 0;
  const pin = pinProvided ? normalizeOperatorPin(body.pin) : null;
  if (!registration || !name || (pinProvided && !pin)) return reply(request, { ok: false, error: 'Informe nome válido e, ao redefinir, PIN numérico de 4 a 8 dígitos.' }, 400);
  const current = await env.DB.prepare('SELECT registration FROM operators WHERE registration=?').bind(registration).first();
  if (!current) return reply(request, { ok: false, error: 'Operador não encontrado.' }, 404);
  if (pinProvided) {
    const salt = randomToken(16);
    await env.DB.prepare(`UPDATE operators SET name=?,pin_salt=?,pin_hash=?,updated_at=CURRENT_TIMESTAMP WHERE registration=?`)
      .bind(name, salt, await operatorPinHash(salt, pin), registration).run();
  } else {
    await env.DB.prepare('UPDATE operators SET name=?,updated_at=CURRENT_TIMESTAMP WHERE registration=?').bind(name, registration).run();
  }
  return reply(request, { ok: true, operator: { registration, name }, pinChanged: pinProvided }, 200, { 'cache-control': 'no-store' });
}

async function setOperatorStatusAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const registration = normalizeRegistration(body.registration);
  if (!registration || typeof body.active !== 'boolean') return reply(request, { ok: false, error: 'Operador ou status inválido.' }, 400);
  const operator = await env.DB.prepare('SELECT registration,name,active FROM operators WHERE registration=?').bind(registration).first();
  if (!operator) return reply(request, { ok: false, error: 'Operador não encontrado.' }, 404);
  if (!body.active) {
    const session = await activeSessionForOperator(env, registration);
    if (session) return reply(request, { ok: false, error: `Encerre primeiro o turno ativo no ${session.equipment_id}.`, conflict: publicSession(session) }, 409);
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE operators SET active=0,updated_at=CURRENT_TIMESTAMP WHERE registration=?').bind(registration),
      env.DB.prepare('UPDATE personal_devices SET active=0 WHERE operator_registration=? AND active=1').bind(registration)
    ]);
    return reply(request, { ok: true, active: false, revokedDevices: results[1].meta.changes }, 200, { 'cache-control': 'no-store' });
  }
  await env.DB.prepare('UPDATE operators SET active=1,updated_at=CURRENT_TIMESTAMP WHERE registration=?').bind(registration).run();
  return reply(request, { ok: true, active: true, requiresDeviceEnrollment: true }, 200, { 'cache-control': 'no-store' });
}

async function forceEndOperatorSessionAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const registration = normalizeRegistration(body.registration);
  if (!registration) return reply(request, { ok: false, error: 'Operador inválido.' }, 400);
  const current = await activeSessionForOperator(env, registration);
  if (!current) return reply(request, { ok: false, error: 'Este operador não possui turno ativo.' }, 404);
  const endedAt = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE operator_sessions
      SET ended_at=?,ended_reason='encerrado remotamente pela coordenação'
      WHERE id=? AND ended_at IS NULL`).bind(endedAt, current.id),
    env.DB.prepare(`INSERT INTO operational_events
      (id,event_type,session_id,equipment_id,operator_registration,occurred_at,payload_json)
      VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), 'shift_force_end', current.id,
        current.equipment_id, registration, endedAt, JSON.stringify({ source: 'admin' }))
  ]);
  if (!results[0].meta.changes) return reply(request, { ok: false, error: 'O turno já havia sido encerrado.' }, 409);
  await finalizeSessionSummary(env, current.id);
  return reply(request, { ok: true, session: { sessionId: current.id, equipmentId: current.equipment_id,
    operatorRegistration: registration, operatorName: current.operator_name, endedAt,
    endedReason: 'encerrado remotamente pela coordenação' } }, 200, { 'cache-control': 'no-store' });
}

async function createPersonalDeviceAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const registration = normalizeRegistration(body.registration);
  const platform = devicePlatform(body.platform);
  const label = String(body.label || '').trim().slice(0, 60) || (platform === 'ios' ? 'iPhone do operador' : 'Android do operador');
  const operator = registration && await env.DB.prepare('SELECT registration,name FROM operators WHERE registration=? AND active=1').bind(registration).first();
  if (!operator || !platform) return reply(request, { ok: false, error: 'Operador ou plataforma inválida.' }, 400);
  const id = `${platform === 'ios' ? 'IOS' : 'AND'}-${deviceSuffix()}`;
  const username = `FICO-${registration}-${deviceSuffix(4)}`;
  const token = createDeviceToken();
  const encrypted = await encryptActivationCode(env, token);
  await env.DB.prepare(`INSERT INTO personal_devices
    (id,operator_registration,platform,label,username,token_hash,token_ciphertext,token_iv)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id, registration, platform, label, username, await sha256(token), encrypted.ciphertext, encrypted.iv).run();
  const device = { id, operator_registration: registration, platform, label, username };
  return reply(request, { ok: true, device: { deviceId: id, operatorRegistration: registration, operatorName: operator.name, platform, label, username, password: token, configuration: ownTracksConfiguration(device, token) } }, 201, { 'cache-control': 'no-store' });
}

async function listPersonalDevicesAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const rows = await env.DB.prepare(`SELECT d.id,d.operator_registration,o.name AS operator_name,d.platform,d.label,d.username,
    d.token_ciphertext,d.token_iv,d.active,d.created_at,d.last_seen_at
    FROM personal_devices d JOIN operators o ON o.registration=d.operator_registration
    ORDER BY d.created_at DESC`).all();
  const devices = [];
  for (const row of rows.results) {
    const token = row.active ? await decryptActivationCode(env, row.token_ciphertext, row.token_iv) : null;
    const device = { id: row.id, operator_registration: row.operator_registration, username: row.username };
    devices.push({ deviceId: row.id, operatorRegistration: row.operator_registration, operatorName: row.operator_name, platform: row.platform, label: row.label, username: row.username, password: token, active: Boolean(row.active), createdAt: row.created_at, lastSeenAt: row.last_seen_at, configuration: token && row.platform === 'ios' ? ownTracksConfiguration(device, token) : null });
  }
  return reply(request, { ok: true, devices }, 200, { 'cache-control': 'no-store' });
}

async function revokePersonalDeviceAdmin(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const deviceId = String(body.deviceId || '');
  const result = await env.DB.prepare('UPDATE personal_devices SET active=0 WHERE id=? AND active=1').bind(deviceId).run();
  if (!result.meta.changes) return reply(request, { ok: false, error: 'Dispositivo não encontrado ou já revogado.' }, 404);
  return reply(request, { ok: true }, 200, { 'cache-control': 'no-store' });
}

async function enrollPersonalAndroid(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const operator = await authenticatedOperator(env, body.registration, body.pin);
  const installationId = String(body.installationId || '');
  if (!operator || !/^[a-zA-Z0-9-]{16,80}$/.test(installationId)) return reply(request, { ok: false, error: 'Matrícula, PIN ou aparelho inválido.' }, 401);
  const installationHash = await sha256(installationId);
  const id = `AND-${installationHash.slice(0, 10).toUpperCase()}`;
  const username = `FICO-${operator.registration}-${id.slice(-4)}`;
  const token = createDeviceToken();
  const encrypted = await encryptActivationCode(env, token);
  await env.DB.prepare(`INSERT INTO personal_devices
    (id,operator_registration,platform,label,username,token_hash,token_ciphertext,token_iv,active)
    VALUES (?,?, 'android','Android pessoal',?,?,?,?,1)
    ON CONFLICT(id) DO UPDATE SET operator_registration=excluded.operator_registration,username=excluded.username,
      token_hash=excluded.token_hash,token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,active=1`)
    .bind(id, operator.registration, username, await sha256(token), encrypted.ciphertext, encrypted.iv).run();
  return reply(request, { ok: true, deviceId: id, deviceToken: token, operatorRegistration: operator.registration, operatorName: operator.name }, 200, { 'cache-control': 'no-store' });
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
  const equipmentSession = await activeOperatorSession(env, equipmentId);
  const operatorSession = await activeSessionForOperator(env, operator.registration);
  if (equipmentSession?.operator_registration === operator.registration) return reply(request, { ok: true, session: publicSession(equipmentSession), alreadyActive: true }, 200, { 'cache-control': 'no-store' });
  if (equipmentSession && body.force !== true) {
    return reply(request, { ok: false, error: 'Equipamento já possui um operador ativo.', conflict: publicSession(equipmentSession) }, 409, { 'cache-control': 'no-store' });
  }
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const statements = [];
  const closedSessionIds = [];
  if (operatorSession) {
    statements.push(env.DB.prepare("UPDATE operator_sessions SET ended_at=?,ended_reason='troca de equipamento' WHERE id=? AND ended_at IS NULL").bind(now, operatorSession.id));
    closedSessionIds.push(operatorSession.id);
  }
  if (equipmentSession && equipmentSession.id !== operatorSession?.id) {
    statements.push(env.DB.prepare("UPDATE operator_sessions SET ended_at=?,ended_reason='substituído' WHERE id=? AND ended_at IS NULL").bind(now, equipmentSession.id));
    closedSessionIds.push(equipmentSession.id);
  }
  statements.push(env.DB.prepare(`INSERT INTO operator_sessions (id,equipment_id,operator_registration,started_at)
    VALUES (?,?,?,?)`).bind(sessionId, equipmentId, operator.registration, now));
  statements.push(env.DB.prepare(`INSERT INTO operational_events
    (id,event_type,session_id,equipment_id,operator_registration,occurred_at,payload_json)
    VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), operatorSession ? 'equipment_change' : 'shift_start', sessionId,
      equipmentId, operator.registration, now, JSON.stringify({ previousEquipmentId: operatorSession?.equipment_id || null })));
  await env.DB.batch(statements);
  await Promise.all(closedSessionIds.map((id) => finalizeSessionSummary(env, id)));
  return reply(request, { ok: true, changedEquipment: Boolean(operatorSession), previousEquipmentId: operatorSession?.equipment_id || null,
    session: { sessionId, equipmentId, operatorName: operator.name, operatorRegistration: operator.registration, startedAt: now } }, 201, { 'cache-control': 'no-store' });
}

async function endOperatorSession(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  const equipmentId = publicEquipmentId(body.equipmentId);
  const operator = await authenticatedOperator(env, body.registration, body.pin);
  if (!equipmentId || !operator) return reply(request, { ok: false, error: 'Equipamento, matrícula ou PIN inválido.' }, 401);
  const current = await activeSessionForOperator(env, operator.registration);
  if (!current || current.equipment_id !== equipmentId) return reply(request, { ok: false, error: 'Não há turno ativo deste operador no equipamento.' }, 404);
  const endedAt = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE operator_sessions SET ended_at=?,ended_reason='encerrado pelo operador'
      WHERE id=? AND ended_at IS NULL`).bind(endedAt, current.id),
    env.DB.prepare(`INSERT INTO operational_events
      (id,event_type,session_id,equipment_id,operator_registration,occurred_at,payload_json)
      VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), 'shift_end', current.id, equipmentId, operator.registration, endedAt, '{}')
  ]);
  if (!results[0].meta.changes) return reply(request, { ok: false, error: 'Não há turno ativo deste operador no equipamento.' }, 404);
  await finalizeSessionSummary(env, current.id);
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

async function persistPersonalPositions(request, env, device, values, ownTracks = false) {
  const session = await activeSessionForOperator(env, device.operator_registration);
  if (!session) return ownTracks
    ? reply(request, [], 200, { 'cache-control': 'no-store', 'x-fico-assignment': 'required' })
    : reply(request, { ok: false, error: 'Identifique o equipamento antes de iniciar o rastreamento.', assignmentRequired: true }, 409);
  if (!values.length || values.length > 100) return reply(request, { ok: false, error: 'Envie de 1 a 100 posições.' }, 400);
  const receivedAt = new Date().toISOString();
  const positions = [];
  for (const value of values) {
    const assigned = { ...value, equipmentId: session.equipment_id };
    const error = validatePosition(assigned);
    if (error) return reply(request, { ok: false, error }, 400);
    positions.push(normalizePosition(assigned, receivedAt));
  }
  const statements = [];
  for (const p of positions) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO positions
      (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no,operator_registration,device_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.equipmentId,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracyM,p.speedMps,p.bearingDeg,p.altitudeM,p.batteryPct,p.sequenceNo,device.operator_registration,device.id));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO position_samples
      (sample_minute,equipment_id,operator_registration,device_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.capturedAt.slice(0,16),p.equipmentId,device.operator_registration,device.id,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracyM,p.speedMps,p.bearingDeg,p.altitudeM,p.batteryPct));
  }
  const newest = [...positions].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  statements.push(env.DB.prepare(`INSERT INTO latest_positions
    (equipment_id,captured_at,received_at,latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct,sequence_no,operator_registration,device_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(equipment_id) DO UPDATE SET captured_at=excluded.captured_at,received_at=excluded.received_at,
      latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,speed_mps=excluded.speed_mps,
      bearing_deg=excluded.bearing_deg,altitude_m=excluded.altitude_m,battery_pct=excluded.battery_pct,
      sequence_no=excluded.sequence_no,operator_registration=excluded.operator_registration,device_id=excluded.device_id
    WHERE excluded.captured_at >= latest_positions.captured_at`).bind(newest.equipmentId,newest.capturedAt,newest.receivedAt,newest.latitude,newest.longitude,newest.accuracyM,newest.speedMps,newest.bearingDeg,newest.altitudeM,newest.batteryPct,newest.sequenceNo,device.operator_registration,device.id));
  statements.push(env.DB.prepare('UPDATE personal_devices SET last_seen_at=? WHERE id=?').bind(receivedAt, device.id));
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
  return ownTracks ? reply(request, [], 200, { 'cache-control': 'no-store' })
    : reply(request, { ok: true, accepted: positions.length, receivedAt, equipmentId: session.equipment_id }, 202);
}

async function ingestPersonal(request, env) {
  const device = await authenticatePersonalBearer(request, env);
  if (!device) return reply(request, { ok: false, error: 'Credencial inválida.' }, 401);
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  return persistPersonalPositions(request, env, device, Array.isArray(body.positions) ? body.positions : [body]);
}

async function ingestPersonalOwnTracks(request, env) {
  const device = await authenticatePersonalOwnTracks(request, env);
  if (!device) return reply(request, { ok: false, error: 'Credencial inválida.' }, 401, { 'www-authenticate': 'Basic realm="FICO OwnTracks"' });
  const raw = await request.text();
  if (!raw.trim()) return reply(request, [], 200);
  let payload;
  try { payload = JSON.parse(raw); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (payload?._type !== 'location') return reply(request, [], 200);
  return persistPersonalPositions(request, env, device, [normalizeOwnTracksLocation(payload, 'LOCO001')], true);
}

async function operationsReport(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, { ok: false, error: 'JSON inválido.' }, 400); }
  if (!adminAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  const equipmentId = body.equipmentId ? publicEquipmentId(body.equipmentId) : null;
  const registration = body.registration ? normalizeRegistration(body.registration) : null;
  const to = new Date(body.to || Date.now());
  const from = new Date(body.from || (to.getTime() - 24 * 3_600_000));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to - from > 90 * 86_400_000) {
    return reply(request, { ok: false, error: 'Período inválido. Consulte no máximo 90 dias.' }, 400);
  }
  if (body.equipmentId && !equipmentId) return reply(request, { ok: false, error: 'Equipamento inválido.' }, 400);
  if (body.registration && !registration) return reply(request, { ok: false, error: 'Operador inválido.' }, 400);
  const filters = [];
  const bindings = [from.toISOString(), to.toISOString()];
  if (equipmentId) { filters.push('s.equipment_id=?'); bindings.push(equipmentId); }
  if (registration) { filters.push('s.operator_registration=?'); bindings.push(registration); }
  const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const sessions = await env.DB.prepare(`SELECT s.id,s.equipment_id,s.operator_registration,o.name AS operator_name,
    s.started_at,s.ended_at,s.ended_reason,m.duration_s,m.points_count,m.moving_s,m.stopped_s,m.gps_distance_m,
    m.avg_moving_speed_mps,m.max_speed_mps
    FROM operator_sessions s JOIN operators o ON o.registration=s.operator_registration
    LEFT JOIN operation_session_summaries m ON m.session_id=s.id
    WHERE s.started_at<? AND COALESCE(s.ended_at,?)>=?${where} ORDER BY s.started_at`)
    .bind(to.toISOString(), to.toISOString(), from.toISOString(), ...bindings.slice(2)).all();
  const pointFilters = [];
  const pointBindings = [from.toISOString(), to.toISOString()];
  if (equipmentId) { pointFilters.push('equipment_id=?'); pointBindings.push(equipmentId); }
  if (registration) { pointFilters.push('operator_registration=?'); pointBindings.push(registration); }
  const pointWhere = pointFilters.length ? ` AND ${pointFilters.join(' AND ')}` : '';
  const rawCutoff = new Date(Math.max(from.getTime(), Date.now() - 7 * 86_400_000)).toISOString();
  const rawBindings = [rawCutoff, to.toISOString(), ...pointBindings.slice(2)];
  const raw = await env.DB.prepare(`SELECT equipment_id,operator_registration,device_id,captured_at,received_at,
    latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct
    FROM positions WHERE captured_at>=? AND captured_at<?${pointWhere} ORDER BY captured_at LIMIT 25000`).bind(...rawBindings).all();
  let sampled = { results: [] };
  if (from.toISOString() < rawCutoff) sampled = await env.DB.prepare(`SELECT equipment_id,operator_registration,device_id,captured_at,received_at,
    latitude,longitude,accuracy_m,speed_mps,bearing_deg,altitude_m,battery_pct
    FROM position_samples WHERE captured_at>=? AND captured_at<?${pointWhere} ORDER BY captured_at LIMIT 25000`)
    .bind(from.toISOString(), rawCutoff, ...pointBindings.slice(2)).all();
  const operators = await env.DB.prepare('SELECT registration,name FROM operators WHERE active=1 ORDER BY name').all();
  const equipment = await env.DB.prepare('SELECT id,name,type FROM equipment WHERE active=1 ORDER BY id').all();
  return reply(request, { ok: true, generatedAt: new Date().toISOString(), from: from.toISOString(), to: to.toISOString(),
    retention: { rawDays: 7, sampledDays: 90, sampledIntervalSeconds: 60 }, operators: operators.results,
    equipment: equipment.results, sessions: sessions.results, positions: [...sampled.results, ...raw.results] }, 200, { 'cache-control': 'no-store' });
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
  const rows = await env.DB.prepare(`SELECT e.id AS equipment_id,e.name,e.type,e.description,
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

async function resetOperationalHistoryAdmin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!historyResetAuthorized(env, body.resetPassword)) {
    return reply(request, { ok: false, error: 'Senha exclusiva de limpeza inválida.' }, 401);
  }

  const countStatements = [
    ['positions', 'SELECT COUNT(*) AS total FROM positions'],
    ['positionSamples', 'SELECT COUNT(*) AS total FROM position_samples'],
    ['latestPositions', 'SELECT COUNT(*) AS total FROM latest_positions'],
    ['sessions', 'SELECT COUNT(*) AS total FROM operator_sessions'],
    ['sessionSummaries', 'SELECT COUNT(*) AS total FROM operation_session_summaries'],
    ['operationalEvents', 'SELECT COUNT(*) AS total FROM operational_events'],
    ['safetyEvents', 'SELECT COUNT(*) AS total FROM safety_events'],
  ];
  const countResults = await env.DB.batch(
    countStatements.map(([, sql]) => env.DB.prepare(sql)),
  );
  const deleted = Object.fromEntries(
    countStatements.map(([name], index) => [
      name,
      Number(countResults[index]?.results?.[0]?.total || 0),
    ]),
  );

  await env.DB.batch([
    env.DB.prepare('DELETE FROM safety_events'),
    env.DB.prepare('DELETE FROM operational_events'),
    env.DB.prepare('DELETE FROM operation_session_summaries'),
    env.DB.prepare('DELETE FROM position_samples'),
    env.DB.prepare('DELETE FROM positions'),
    env.DB.prepare('DELETE FROM latest_positions'),
    env.DB.prepare('DELETE FROM operator_sessions'),
  ]);

  return reply(request, {
    ok: true,
    deleted,
    preserved: ['equipment', 'operators', 'personal_devices', 'activation_codes', 'requesters', 'cco_controllers', 'ldl', 'circulations', 'permissive_authorizations'],
    resetAt: new Date().toISOString(),
  });
}

async function listEquipmentAdmin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!adminAuthorized(env, body.adminPassword)) {
    return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  }
  const rows = await env.DB.prepare(
    'SELECT id,name,type,description,active FROM equipment ORDER BY type,id',
  ).all();
  return reply(request, { ok: true, equipment: rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description || '',
    active: Boolean(row.active),
  })) });
}

async function updateEquipmentAdmin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!adminAuthorized(env, body.adminPassword)) {
    return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  }
  const id = publicEquipmentId(body.equipmentId);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const description = String(body.description || '').trim().replace(/\s+/g, ' ');
  if (!id) return reply(request, { ok: false, error: 'Equipamento inválido.' }, 400);
  if (name.length < 2 || name.length > 80) {
    return reply(request, { ok: false, error: 'O nome deve ter entre 2 e 80 caracteres.' }, 400);
  }
  if (description.length > 500) {
    return reply(request, { ok: false, error: 'A descrição deve ter no máximo 500 caracteres.' }, 400);
  }
  const result = await env.DB.prepare(
    'UPDATE equipment SET name=?,description=? WHERE id=?',
  ).bind(name, description || null, id).run();
  if (!result.meta?.changes) {
    return reply(request, { ok: false, error: 'Equipamento não encontrado.' }, 404);
  }
  return reply(request, { ok: true, equipment: { id, name, description } });
}

async function route(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  const radarResponse = await routeRadar(request, env);
  if (radarResponse) return radarResponse;
  const ccoResponse = await routeCco(request, env);
  if (ccoResponse) return ccoResponse;
  const organogramResponse = await routeOrganogram(request, env);
  if (organogramResponse) return organogramResponse;
  const socariaResponse = await routeSocaria(request, env);
  if (socariaResponse) return socariaResponse;
  const ntcResponse = await routeNtc(request, env);
  if (ntcResponse) return ntcResponse;
  if (request.method === 'GET' && url.pathname === '/health') return reply(request, { ok: true, service: 'fico-tracking-api', time: new Date().toISOString() });
  if (request.method === 'GET' && url.pathname === '/ready') return readiness(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/activate') return activate(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operators') return registerOperator(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/admin/activation-codes/list') return listActivationCodes(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/admin/activation-codes/generate') return generateActivationCode(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operators/list') return listOperatorsAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operators/create') return createOperatorAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operators/update') return updateOperatorAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operators/status') return setOperatorStatusAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operators/end-session') return forceEndOperatorSessionAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/devices/create') return createPersonalDeviceAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/devices/list') return listPersonalDevicesAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/devices/revoke') return revokePersonalDeviceAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/operations/report') return operationsReport(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/history/reset') return resetOperationalHistoryAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/equipment/list') return listEquipmentAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/admin/equipment/update') return updateEquipmentAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/device/enroll') return enrollPersonalAndroid(request, env);
  if (request.method === 'GET' && url.pathname === '/api/v1/operator/session') return getOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operator/session/start') return startOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/operator/session/end') return endOperatorSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/positions') return ingest(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v1/owntracks') return ingestOwnTracks(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/positions') return ingestPersonal(request, env);
  if (request.method === 'POST' && url.pathname === '/api/v2/owntracks') return ingestPersonalOwnTracks(request, env);
  if (request.method === 'GET' && url.pathname === '/api/v1/equipment/latest') return latest(request, env);
  const match = url.pathname.match(/^\/api\/v1\/equipment\/([^/]+)\/history$/);
  if (request.method === 'GET' && match) return history(request, env, decodeURIComponent(match[1]));
  return reply(request, { ok: false, error: 'Rota não encontrada.' }, 404);
}

export default {
  async fetch(request, env) {
    const id = requestId();
    const startedAt = Date.now();
    try {
      const response = await route(request, env);
      if (response.status >= 500) {
        console.error(JSON.stringify({ event: 'request_5xx', requestId: id, method: request.method, path: new URL(request.url).pathname, status: response.status }));
      }
      return withRequestMetadata(response, id, startedAt);
    } catch (error) {
      logRequestFailure(request, id, error);
      return reply(request, {
        ok: false,
        error: 'Serviço temporariamente indisponível. Tente novamente.',
        requestId: id,
      }, 503, { 'x-request-id': id, 'cache-control': 'no-store' });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("DELETE FROM positions WHERE captured_at < datetime('now','-7 days')"),
      env.DB.prepare("DELETE FROM position_samples WHERE captured_at < datetime('now','-90 days')"),
      env.DB.prepare("DELETE FROM cco_sessions WHERE expires_at < CURRENT_TIMESTAMP")
      ,env.DB.prepare("DELETE FROM radar_sessions WHERE expires_at < CURRENT_TIMESTAMP")
      ,env.DB.prepare("DELETE FROM radar_front_events WHERE occurred_at < datetime('now','-90 days')")
      ,env.DB.prepare("DELETE FROM radar_checkins WHERE captured_at < datetime('now','-90 days')")
    ]));
  }
};
