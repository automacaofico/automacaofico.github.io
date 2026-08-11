const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function cors(request) {
  const origin = request.headers.get('origin');
  const allowed = !origin || origin === 'https://automacaofico.github.io' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  return { 'access-control-allow-origin': allowed && origin ? origin : 'https://automacaofico.github.io', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', vary: 'Origin' };
}

function reply(request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(request), 'cache-control': 'no-store', ...extraHeaders } });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function token(bytesLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clean(value, max = 200) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function code(value) { const result = clean(value, 16).toUpperCase(); return /^[A-Z0-9-]{3,16}$/.test(result) ? result : null; }
function monthFrom(iso) { return new Date(iso).toISOString().slice(0, 7); }
function iso(value) { const date = new Date(value); return Number.isFinite(date.valueOf()) ? date.toISOString() : null; }
function numeric(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function activeAuthorized(env, value) { return Boolean(env.OPERATOR_ADMIN_PASSWORD) && String(value || '') === env.OPERATOR_ADMIN_PASSWORD; }

const DOUBLE_TRACK_RANGES = [[3880,6929],[19699,20299],[32182,34217],[47902,48502],[59878,61914],[72242,72842],[84222,86207],[101202,101802],[110662,112737],[120192,120792]];
const SPECIAL_TRACK_RANGES = { south_loop: [0,2734], line_egp: [5520,6084], welding_yard: [6099,6538] };
const OPERATIONAL_LINES = ['line01', 'line02', ...Object.keys(SPECIAL_TRACK_RANGES)];
export function lineRangeAvailable(line, kmStart, kmEnd) {
  if (line === 'line01') return true;
  if (line === 'line02') return DOUBLE_TRACK_RANGES.some(([start, end]) => Number(kmStart) >= start && Number(kmEnd) <= end);
  const range = SPECIAL_TRACK_RANGES[line];
  return Boolean(range && Number(kmStart) >= range[0] && Number(kmEnd) <= range[1]);
}

export function permissiveLinksMatch(conflicts, suppliedLinks) {
  const required = conflicts.map((item) => `${item.kind}:${item.id}`).sort();
  const supplied = suppliedLinks.filter((item) => /^(LDL|CIRC):/.test(item)).sort();
  return required.length === supplied.length && required.every((item, index) => item === supplied[index]);
}

export function permissionContainedByConflicts({ kmStart, kmEnd, start, end }, conflicts, now = Date.now()) {
  return conflicts.every((item) => {
    const effectiveEnd = Date.parse(item.end) < now ? Infinity : Date.parse(item.end);
    return kmStart >= Number(item.km_start) && kmEnd <= Number(item.km_end) && Date.parse(start) >= Date.parse(item.start) && Date.parse(end) <= effectiveEnd;
  });
}

async function controllerAuth(request, env) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return null;
  const hash = await sha256(bearer);
  return env.DB.prepare(`SELECT c.code,c.name FROM cco_sessions s JOIN cco_controllers c ON c.code=s.controller_code
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND c.active=1`).bind(hash).first();
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const controllerCode = code(body.code), pin = String(body.pin || '').trim();
  if (!controllerCode || !/^\d{4,12}$/.test(pin)) return reply(request, { ok: false, error: 'Código ou PIN inválido.' }, 401);
  const controller = await env.DB.prepare('SELECT code,name,pin_salt,pin_hash FROM cco_controllers WHERE code=? AND active=1').bind(controllerCode).first();
  if (!controller || await sha256(`${controller.pin_salt}:${pin}`) !== controller.pin_hash) return reply(request, { ok: false, error: 'Código ou PIN inválido.' }, 401);
  const value = token(), hash = await sha256(value), expiresAt = new Date(Date.now() + 12 * 3600000).toISOString();
  await env.DB.prepare('INSERT INTO cco_sessions (token_hash,controller_code,expires_at) VALUES (?,?,?)').bind(hash, controller.code, expiresAt).run();
  return reply(request, { ok: true, token: value, expiresAt, controller: { code: controller.code, name: controller.name } });
}

async function logout(request, env) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) await env.DB.prepare('DELETE FROM cco_sessions WHERE token_hash=?').bind(await sha256(bearer)).run();
  return reply(request, { ok: true });
}

async function monthlySequence(env, kind, month) {
  const row = await env.DB.prepare(`INSERT INTO monthly_sequences (kind,month,last_value) VALUES (?,?,1)
    ON CONFLICT(kind,month) DO UPDATE SET last_value=last_value+1 RETURNING last_value`).bind(kind, month).first();
  return Number(row.last_value);
}

async function permissiveMonthlySequence(env, month) {
  const row = await env.DB.prepare(`INSERT INTO permissive_monthly_sequences (month,last_value) VALUES (?,1)
    ON CONFLICT(month) DO UPDATE SET last_value=last_value+1 RETURNING last_value`).bind(month).first();
  return Number(row.last_value);
}

function effectiveOverlapSql(alias, endColumn) {
  return `${alias}.planned_start<=? AND (CASE WHEN ${alias}.status='authorized' AND ${alias}.${endColumn}<CURRENT_TIMESTAMP THEN '9999-12-31T23:59:59.999Z' ELSE ${alias}.${endColumn} END)>=?`;
}

async function findConflicts(env, { lines, kmStart, kmEnd, start, end, ignoreLdl = null, ignoreCirculation = null, includePermissives = true }) {
  const placeholders = lines.map(() => '?').join(','), ldlBindings = [...lines, kmEnd, kmStart, end, start], circBindings = [...lines, kmEnd, kmStart, end, start];
  let ldlSql = `SELECT DISTINCT l.id,l.permanent_code AS code,l.km_start,l.km_end,l.requested_start AS start,l.requested_end AS end,'LDL' AS kind
    FROM ldl l JOIN ldl_lines ll ON ll.ldl_id=l.id WHERE l.status='active' AND ll.line_id IN (${placeholders})
    AND l.km_start<=? AND l.km_end>=? AND l.requested_start<=?
    AND (CASE WHEN l.requested_end<CURRENT_TIMESTAMP THEN '9999-12-31T23:59:59.999Z' ELSE l.requested_end END)>=?`;
  if (ignoreLdl) { ldlSql += ' AND l.id<>?'; ldlBindings.push(ignoreLdl); }
  let circSql = `SELECT c.id,c.permanent_code AS code,c.equipment_id,c.km_start,c.km_end,c.planned_start AS start,c.planned_end AS end,'CIRC' AS kind
    FROM circulations c WHERE c.status='authorized' AND c.line_id IN (${placeholders}) AND c.km_start<=? AND c.km_end>=?
    AND ${effectiveOverlapSql('c', 'planned_end')}`;
  if (ignoreCirculation) { circSql += ' AND c.id<>?'; circBindings.push(ignoreCirculation); }
  const statements = [env.DB.prepare(ldlSql).bind(...ldlBindings), env.DB.prepare(circSql).bind(...circBindings)];
  if (includePermissives) statements.push(env.DB.prepare(`SELECT p.id,p.permanent_code AS code,p.km_start,p.km_end,p.planned_start AS start,p.planned_end AS end,'PERM' AS kind
    FROM permissive_authorizations p WHERE p.status='active' AND p.line_id IN (${placeholders}) AND p.km_start<=? AND p.km_end>=?
    AND p.planned_start<=? AND (CASE WHEN p.planned_end<CURRENT_TIMESTAMP THEN '9999-12-31T23:59:59.999Z' ELSE p.planned_end END)>=?`).bind(...lines, kmEnd, kmStart, end, start));
  const results = await env.DB.batch(statements);
  return results.flatMap((result) => result.results || []);
}

async function baseState(env, from = null, to = null) {
  const start = from || new Date(Date.now() - 31 * 86400000).toISOString(), end = to || new Date(Date.now() + 31 * 86400000).toISOString();
  const [requesters, lines, equipment, operators, ldls, ldlLines, circulations, permissives, permissiveLinks, latest, safetyEvents] = await env.DB.batch([
    env.DB.prepare('SELECT code,name,role,company,supervisor,active FROM requesters ORDER BY active DESC,name'),
    env.DB.prepare('SELECT id,name,geometry_status,active FROM track_lines WHERE active=1 ORDER BY id'),
    env.DB.prepare('SELECT id,name,type,description FROM equipment WHERE active=1 ORDER BY id'),
    env.DB.prepare('SELECT registration,name FROM operators WHERE active=1 ORDER BY name'),
    env.DB.prepare(`SELECT l.*,r.name AS requester_name,r.company,c.name AS controller_name FROM ldl l
      JOIN requesters r ON r.code=l.requester_code JOIN cco_controllers c ON c.code=l.created_by_controller
      WHERE l.status='active' OR (l.created_at>=? AND l.created_at<=?) ORDER BY l.created_at DESC`).bind(start, end),
    env.DB.prepare('SELECT ldl_id,line_id FROM ldl_lines'),
    env.DB.prepare(`SELECT c.*,e.name AS equipment_name,o.name AS operator_name,cc.name AS controller_name FROM circulations c
      JOIN equipment e ON e.id=c.equipment_id LEFT JOIN operators o ON o.registration=c.operator_registration
      JOIN cco_controllers cc ON cc.code=c.authorized_by_controller
      WHERE c.status='authorized' OR (c.authorized_at>=? AND c.authorized_at<=?) ORDER BY c.authorized_at DESC`).bind(start, end),
    env.DB.prepare(`SELECT p.*,e.name AS equipment_name,o.name AS operator_name,cc.name AS controller_name FROM permissive_authorizations p
      JOIN equipment e ON e.id=p.equipment_id LEFT JOIN operators o ON o.registration=p.operator_registration
      JOIN cco_controllers cc ON cc.code=p.authorized_by_controller
      WHERE p.status='active' OR (p.authorized_at>=? AND p.authorized_at<=?) ORDER BY p.authorized_at DESC`).bind(start, end),
    env.DB.prepare('SELECT permission_id,record_kind,record_id FROM permissive_links'),
    env.DB.prepare('SELECT equipment_id,captured_at,latitude,longitude,accuracy_m,speed_mps,battery_pct FROM latest_positions'),
    env.DB.prepare(`SELECT s.*,l.permanent_code AS ldl_code FROM safety_events s JOIN ldl l ON l.id=s.ldl_id
      WHERE s.status='active' OR s.first_seen_at>=? ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,s.last_seen_at DESC LIMIT 100`).bind(start)
  ]);
  const linesByLdl = {};
  for (const row of ldlLines.results || []) (linesByLdl[row.ldl_id] ||= []).push(row.line_id);
  const linksByPermission = {};
  for (const row of permissiveLinks.results || []) (linksByPermission[row.permission_id] ||= []).push({ kind: row.record_kind, id: row.record_id });
  return { requesters: requesters.results, lines: lines.results, equipment: equipment.results, operators: operators.results,
    ldls: (ldls.results || []).map((row) => ({ ...row, lines: linesByLdl[row.id] || [] })), circulations: circulations.results,
    permissives: (permissives.results || []).map((row) => ({ ...row, links: linksByPermission[row.id] || [] })), latest: latest.results,
    safetyEvents: safetyEvents.results || [] };
}

async function state(request, env, controller) {
  const url = new URL(request.url), from = iso(url.searchParams.get('from')), to = iso(url.searchParams.get('to'));
  return reply(request, { ok: true, serverTime: new Date().toISOString(), controller, ...(await baseState(env, from, to)) });
}

async function publicOperations(request, env) {
  const [ldls, ldlLines, circulations, permissives, permissiveLinks, safetyEvents] = await env.DB.batch([
    env.DB.prepare(`SELECT l.id,l.sequence_number,l.permanent_code,l.requester_code,r.name AS requester_name,r.company,
      l.km_start,l.km_end,l.workforce_count,l.work_description,l.requested_start,l.requested_end,l.created_at
      FROM ldl l JOIN requesters r ON r.code=l.requester_code WHERE l.status='active' ORDER BY l.km_start,l.created_at`),
    env.DB.prepare(`SELECT ll.ldl_id,ll.line_id FROM ldl_lines ll JOIN ldl l ON l.id=ll.ldl_id WHERE l.status='active'`),
    env.DB.prepare(`SELECT c.id,c.sequence_number,c.permanent_code,c.equipment_id,e.name AS equipment_name,c.line_id,
      c.km_start,c.km_end,c.planned_start,c.planned_end,c.direction,c.authorized_at
      FROM circulations c JOIN equipment e ON e.id=c.equipment_id WHERE c.status='authorized' ORDER BY c.km_start,c.authorized_at`),
    env.DB.prepare(`SELECT p.id,p.sequence_number,p.permanent_code,p.equipment_id,e.name AS equipment_name,p.line_id,p.km_start,p.km_end,
      p.planned_start,p.planned_end,p.speed_limit_kmh,p.work_description,p.justification,p.authorized_at
      FROM permissive_authorizations p JOIN equipment e ON e.id=p.equipment_id WHERE p.status='active' ORDER BY p.km_start,p.authorized_at`),
    env.DB.prepare(`SELECT pl.permission_id,pl.record_kind,COALESCE(l.permanent_code,c.permanent_code) AS record_code
      FROM permissive_links pl JOIN permissive_authorizations p ON p.id=pl.permission_id
      LEFT JOIN ldl l ON pl.record_kind='LDL' AND l.id=pl.record_id
      LEFT JOIN circulations c ON pl.record_kind='CIRC' AND c.id=pl.record_id WHERE p.status='active'`),
    env.DB.prepare(`SELECT s.id,s.event_type,s.status,s.equipment_id,s.captured_at,s.station_m,s.speed_kmh,s.first_seen_at,s.last_seen_at,s.occurrences,
      l.permanent_code AS ldl_code FROM safety_events s JOIN ldl l ON l.id=s.ldl_id WHERE s.status='active' ORDER BY s.last_seen_at DESC`)
  ]);
  const linesByLdl = {}, linksByPermission = {};
  for (const row of ldlLines.results || []) (linesByLdl[row.ldl_id] ||= []).push(row.line_id);
  for (const row of permissiveLinks.results || []) (linksByPermission[row.permission_id] ||= []).push({ kind: row.record_kind, code: row.record_code });
  return reply(request, {
    ok: true,
    serverTime: new Date().toISOString(),
    refreshSeconds: 5,
    ldls: (ldls.results || []).map((row) => ({ ...row, lines: linesByLdl[row.id] || [] })),
    circulations: circulations.results || [],
    safetyEvents: safetyEvents.results || [],
    permissives: (permissives.results || []).map((row) => ({ ...row, links: linksByPermission[row.id] || [] }))
  }, 200, { 'cache-control': 'public, max-age=3' });
}

async function syncSafetyEvents(request, env, controller) {
  const body = await request.json().catch(() => ({})), supplied = Array.isArray(body.detections) ? body.detections.slice(0, 50) : [];
  const now = new Date().toISOString(), activeKeys = [];
  for (const item of supplied) {
    const equipmentId = code(item.equipmentId), ldlId = clean(item.ldlId, 64), capturedAt = iso(item.capturedAt);
    const stationM = numeric(item.stationM), distanceM = numeric(item.distanceM);
    if (!equipmentId || !ldlId || !capturedAt || stationM === null || distanceM === null || distanceM < 0 || distanceM > 100) continue;
    const context = await env.DB.prepare(`SELECT l.id,l.km_start,l.km_end,p.captured_at,p.accuracy_m,p.speed_mps
      FROM ldl l JOIN ldl_lines ll ON ll.ldl_id=l.id AND ll.line_id='line01'
      JOIN latest_positions p ON p.equipment_id=? WHERE l.id=? AND l.status='active'`).bind(equipmentId, ldlId).first();
    if (!context || Math.abs(Date.parse(context.captured_at) - Date.parse(capturedAt)) > 10000 || Date.now() - Date.parse(context.captured_at) > 120000 || stationM < Number(context.km_start) || stationM > Number(context.km_end)) continue;
    const eventKey = `LDL_INTRUSION:${equipmentId}:${ldlId}`, existing = await env.DB.prepare("SELECT id FROM safety_events WHERE event_key=? AND status='active'").bind(eventKey).first();
    const speedKmh = Math.max(0, Number(context.speed_mps || 0) * 3.6), accuracyM = numeric(context.accuracy_m);
    if (existing) await env.DB.prepare(`UPDATE safety_events SET captured_at=?,station_m=?,distance_to_axis_m=?,accuracy_m=?,speed_kmh=?,last_seen_at=?,occurrences=occurrences+1 WHERE id=?`).bind(context.captured_at, stationM, distanceM, accuracyM, speedKmh, now, existing.id).run();
    else await env.DB.prepare(`INSERT INTO safety_events (id,event_key,event_type,severity,status,equipment_id,ldl_id,captured_at,station_m,distance_to_axis_m,accuracy_m,speed_kmh,first_seen_at,last_seen_at,detected_by_controller)
      VALUES (?,?, 'LDL_INTRUSION','critical','active',?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), eventKey, equipmentId, ldlId, context.captured_at, stationM, distanceM, accuracyM, speedKmh, now, now, controller.code).run();
    activeKeys.push(eventKey);
  }
  const open = await env.DB.prepare("SELECT id,event_key FROM safety_events WHERE status='active'").all();
  for (const event of open.results || []) if (!activeKeys.includes(event.event_key)) await env.DB.prepare("UPDATE safety_events SET status='resolved',resolved_at=?,last_seen_at=? WHERE id=?").bind(now, now, event.id).run();
  const events = await env.DB.prepare(`SELECT s.*,l.permanent_code AS ldl_code FROM safety_events s JOIN ldl l ON l.id=s.ldl_id
    WHERE s.status='active' OR s.first_seen_at>=datetime('now','-24 hours') ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,s.last_seen_at DESC LIMIT 100`).all();
  return reply(request, { ok: true, events: events.results || [] });
}

async function createLdl(request, env, controller) {
  const body = await request.json().catch(() => ({})), requesterCode = code(body.requesterCode);
  const kmStart = numeric(body.kmStart), kmEnd = numeric(body.kmEnd), start = iso(body.start), end = iso(body.end);
  const lines = [...new Set(Array.isArray(body.lines) ? body.lines.map((line) => clean(line)) : [])].filter((line) => OPERATIONAL_LINES.includes(line));
  const workforce = Math.round(numeric(body.workforceCount) || 0), description = clean(body.description, 500), channel = body.channel;
  if (!requesterCode || kmStart === null || kmEnd === null || kmStart < 0 || kmEnd <= kmStart || !start || !end || end <= start || !lines.length || workforce < 1 || workforce > 2000 || description.length < 3 || !['radio', 'whatsapp'].includes(channel)) return reply(request, { ok: false, error: 'Revise solicitante, linhas, KM, horários, efetivo, serviço e canal.' }, 400);
  if (lines.some((line) => !lineRangeAvailable(line, kmStart, kmEnd))) return reply(request, { ok: false, error: 'Uma das linhas selecionadas não existe em todo o trecho informado. Divida a LDL conforme os limites do pátio, DTO ou linha especial.' }, 400);
  const requester = await env.DB.prepare('SELECT code FROM requesters WHERE code=? AND active=1').bind(requesterCode).first();
  if (!requester) return reply(request, { ok: false, error: 'Solicitante inativo ou não cadastrado.' }, 400);
  const conflicts = await findConflicts(env, { lines, kmStart, kmEnd, start, end });
  if (conflicts.length) return reply(request, { ok: false, error: 'Trecho indisponível. Existe conflito operacional.', conflicts }, 409);
  const month = monthFrom(start), sequence = await monthlySequence(env, 'LDL', month), permanentCode = `LDL-${month}-${String(sequence).padStart(3, '0')}`, id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ldl (id,sequence_number,sequence_month,permanent_code,requester_code,km_start,km_end,workforce_count,work_description,requested_start,requested_end,request_channel,created_by_controller,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, sequence, month, permanentCode, requesterCode, kmStart, kmEnd, workforce, description, start, end, channel, controller.code, now),
    ...lines.map((line) => env.DB.prepare('INSERT INTO ldl_lines (ldl_id,line_id) VALUES (?,?)').bind(id, line)),
    env.DB.prepare('INSERT INTO ldl_events (id,ldl_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, 'created', controller.code, now, JSON.stringify({ lines, channel }))
  ]);
  return reply(request, { ok: true, ldl: { id, displayCode: `LDL ${String(sequence).padStart(3, '0')}`, permanentCode, lines } }, 201);
}

async function closeLdl(request, env, controller) {
  const body = await request.json().catch(() => ({})), id = clean(body.id, 80), action = body.action, note = clean(body.note, 500), now = new Date().toISOString();
  const current = await env.DB.prepare('SELECT id,status FROM ldl WHERE id=?').bind(id).first();
  const linkedPermission = await env.DB.prepare(`SELECT p.permanent_code FROM permissive_authorizations p JOIN permissive_links pl ON pl.permission_id=p.id
    WHERE p.status='active' AND pl.record_kind='LDL' AND pl.record_id=? LIMIT 1`).bind(id).first();
  if (linkedPermission) return reply(request, { ok: false, error: `Encerre primeiro a operação permissiva ${linkedPermission.permanent_code}.` }, 409);
  if (!current || current.status !== 'active') return reply(request, { ok: false, error: 'LDL ativa não encontrada.' }, 404);
  if (action === 'return') await env.DB.prepare(`UPDATE ldl SET status='returned',returned_at=?,returned_by_controller=?,return_note=? WHERE id=?`).bind(now, controller.code, note || null, id).run();
  else if (action === 'cancel' && note.length >= 3) await env.DB.prepare(`UPDATE ldl SET status='cancelled',cancelled_at=?,cancelled_by_controller=?,cancel_reason=? WHERE id=?`).bind(now, controller.code, note, id).run();
  else return reply(request, { ok: false, error: 'Ação inválida ou justificativa ausente.' }, 400);
  await env.DB.prepare('INSERT INTO ldl_events (id,ldl_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, action === 'return' ? 'returned' : 'cancelled', controller.code, now, JSON.stringify({ note })).run();
  return reply(request, { ok: true });
}

async function createCirculation(request, env, controller) {
  const body = await request.json().catch(() => ({})), equipmentId = code(body.equipmentId), operatorRegistration = code(body.operatorRegistration), line = clean(body.line);
  const kmStart = numeric(body.kmStart), kmEnd = numeric(body.kmEnd), start = iso(body.start), end = iso(body.end), direction = body.direction, restrictions = clean(body.restrictions, 500);
  if (!equipmentId || !OPERATIONAL_LINES.includes(line) || kmStart === null || kmEnd === null || kmStart < 0 || kmEnd <= kmStart || !start || !end || end <= start || !['crescente', 'decrescente', 'manobra'].includes(direction)) return reply(request, { ok: false, error: 'Revise equipamento, linha, KM, horários e sentido.' }, 400);
  if (!lineRangeAvailable(line, kmStart, kmEnd)) return reply(request, { ok: false, error: 'A linha selecionada não existe em todo o trecho informado. Divida a circulação conforme os limites da infraestrutura.' }, 400);
  const equipment = await env.DB.prepare('SELECT id FROM equipment WHERE id=? AND active=1').bind(equipmentId).first();
  if (!equipment) return reply(request, { ok: false, error: 'Equipamento não cadastrado.' }, 400);
  if (operatorRegistration && !await env.DB.prepare('SELECT registration FROM operators WHERE registration=? AND active=1').bind(operatorRegistration).first()) return reply(request, { ok: false, error: 'Operador não cadastrado.' }, 400);
  const conflicts = await findConflicts(env, { lines: [line], kmStart, kmEnd, start, end });
  if (conflicts.length) return reply(request, { ok: false, error: 'Circulação proibida. Existe conflito operacional.', conflicts }, 409);
  const month = monthFrom(start), sequence = await monthlySequence(env, 'CIRC', month), permanentCode = `CIRC-${month}-${String(sequence).padStart(3, '0')}`, id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO circulations (id,sequence_number,sequence_month,permanent_code,equipment_id,operator_registration,line_id,km_start,km_end,planned_start,planned_end,direction,restrictions,authorized_by_controller,authorized_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, sequence, month, permanentCode, equipmentId, operatorRegistration || null, line, kmStart, kmEnd, start, end, direction, restrictions || null, controller.code, now),
    env.DB.prepare('INSERT INTO circulation_events (id,circulation_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, 'authorized', controller.code, now, JSON.stringify({ line }))
  ]);
  return reply(request, { ok: true, circulation: { id, displayCode: `CIRC ${String(sequence).padStart(3, '0')}`, permanentCode } }, 201);
}

async function closeCirculation(request, env, controller) {
  const body = await request.json().catch(() => ({})), id = clean(body.id, 80), action = body.action, note = clean(body.note, 500), now = new Date().toISOString();
  const current = await env.DB.prepare("SELECT id,status FROM circulations WHERE id=?").bind(id).first();
  const linkedPermission = await env.DB.prepare(`SELECT p.permanent_code FROM permissive_authorizations p JOIN permissive_links pl ON pl.permission_id=p.id
    WHERE p.status='active' AND pl.record_kind='CIRC' AND pl.record_id=? LIMIT 1`).bind(id).first();
  if (linkedPermission) return reply(request, { ok: false, error: `Encerre primeiro a operação permissiva ${linkedPermission.permanent_code}.` }, 409);
  if (!current || current.status !== 'authorized') return reply(request, { ok: false, error: 'Circulação ativa não encontrada.' }, 404);
  if (action === 'complete') await env.DB.prepare(`UPDATE circulations SET status='completed',completed_at=?,completed_by_controller=? WHERE id=?`).bind(now, controller.code, id).run();
  else if (action === 'cancel' && note.length >= 3) await env.DB.prepare(`UPDATE circulations SET status='cancelled',cancelled_at=?,cancelled_by_controller=?,cancel_reason=? WHERE id=?`).bind(now, controller.code, note, id).run();
  else return reply(request, { ok: false, error: 'Ação inválida ou justificativa ausente.' }, 400);
  await env.DB.prepare('INSERT INTO circulation_events (id,circulation_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, action === 'complete' ? 'completed' : 'cancelled', controller.code, now, JSON.stringify({ note })).run();
  return reply(request, { ok: true });
}

async function createPermissive(request, env, controller) {
  const body = await request.json().catch(() => ({})), equipmentId = code(body.equipmentId), operatorRegistration = code(body.operatorRegistration), line = clean(body.line);
  const kmStart = numeric(body.kmStart), kmEnd = numeric(body.kmEnd), start = iso(body.start), end = iso(body.end);
  const description = clean(body.description, 500), justification = clean(body.justification, 500), channel = body.channel;
  const selectedLinks = [...new Set((Array.isArray(body.linkedRecords) ? body.linkedRecords : []).map((item) => `${clean(item?.kind, 8).toUpperCase()}:${clean(item?.id, 80)}`))];
  if (!equipmentId || !OPERATIONAL_LINES.includes(line) || kmStart === null || kmEnd === null || kmStart < 0 || kmEnd <= kmStart || !start || !end || end <= start || description.length < 3 || justification.length < 5 || !['radio', 'whatsapp'].includes(channel) || body.communicationConfirmed !== true) return reply(request, { ok: false, error: 'Revise equipamento, linha, KM, horários, serviço, justificativa e confirmação da comunicação.' }, 400);
  if (!lineRangeAvailable(line, kmStart, kmEnd)) return reply(request, { ok: false, error: 'A linha selecionada não existe em todo o trecho permissivo informado.' }, 400);
  const equipment = await env.DB.prepare('SELECT id FROM equipment WHERE id=? AND active=1').bind(equipmentId).first();
  if (!equipment) return reply(request, { ok: false, error: 'Equipamento não cadastrado.' }, 400);
  if (operatorRegistration && !await env.DB.prepare('SELECT registration FROM operators WHERE registration=? AND active=1').bind(operatorRegistration).first()) return reply(request, { ok: false, error: 'Operador não cadastrado.' }, 400);
  const equipmentBusy = await env.DB.prepare(`SELECT permanent_code FROM permissive_authorizations WHERE equipment_id=? AND status='active'
    AND planned_start<=? AND (CASE WHEN planned_end<CURRENT_TIMESTAMP THEN '9999-12-31T23:59:59.999Z' ELSE planned_end END)>=?`).bind(equipmentId, end, start).first();
  if (equipmentBusy) return reply(request, { ok: false, error: `Equipamento já vinculado ao permissivo ${equipmentBusy.permanent_code}.` }, 409);
  const conflicts = await findConflicts(env, { lines: [line], kmStart, kmEnd, start, end });
  const permissiveConflict = conflicts.find((item) => item.kind === 'PERM');
  if (permissiveConflict) return reply(request, { ok: false, error: 'Já existe uma operação permissiva neste trecho e período.', conflicts: [permissiveConflict] }, 409);
  const operationalConflicts = conflicts.filter((item) => item.kind === 'LDL' || item.kind === 'CIRC');
  if (!operationalConflicts.length) return reply(request, { ok: false, error: 'Não existe conflito operacional para justificar uma autorização permissiva. Use a circulação normal.' }, 409);
  if (!permissiveLinksMatch(operationalConflicts, selectedLinks)) return reply(request, { ok: false, error: 'Selecione todos e somente os registros conflitantes indicados pelo sistema.', conflicts: operationalConflicts }, 409);
  if (!permissionContainedByConflicts({ kmStart, kmEnd, start, end }, operationalConflicts)) return reply(request, { ok: false, error: 'O trecho e o período permissivos devem estar totalmente contidos em todos os registros vinculados.', conflicts: operationalConflicts }, 409);
  const linkedCirculation = operationalConflicts.find((item) => item.kind === 'CIRC' && item.id && item.equipment_id === equipmentId);
  if (linkedCirculation) return reply(request, { ok: false, error: 'O equipamento já está representado pela circulação selecionada.' }, 400);
  const month = monthFrom(start), sequence = await permissiveMonthlySequence(env, month), permanentCode = `PERM-${month}-${String(sequence).padStart(3, '0')}`, id = crypto.randomUUID(), now = new Date().toISOString();
  const links = operationalConflicts.map((item) => ({ kind: item.kind, id: item.id }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO permissive_authorizations (id,sequence_number,sequence_month,permanent_code,equipment_id,operator_registration,line_id,km_start,km_end,planned_start,planned_end,speed_limit_kmh,work_description,justification,communication_channel,communication_confirmed,authorized_by_controller,authorized_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, sequence, month, permanentCode, equipmentId, operatorRegistration || null, line, kmStart, kmEnd, start, end, 15, description, justification, channel, 1, controller.code, now),
    ...links.map((item) => env.DB.prepare('INSERT INTO permissive_links (permission_id,record_kind,record_id) VALUES (?,?,?)').bind(id, item.kind, item.id)),
    env.DB.prepare('INSERT INTO permissive_events (id,permission_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, 'authorized', controller.code, now, JSON.stringify({ speedLimitKmh: 15, line, links, channel, communicationConfirmed: true }))
  ]);
  return reply(request, { ok: true, permissive: { id, displayCode: `PERM ${String(sequence).padStart(3, '0')}`, permanentCode, speedLimitKmh: 15 } }, 201);
}

async function closePermissive(request, env, controller) {
  const body = await request.json().catch(() => ({})), id = clean(body.id, 80), action = body.action, note = clean(body.note, 500), now = new Date().toISOString();
  const current = await env.DB.prepare("SELECT id,status FROM permissive_authorizations WHERE id=?").bind(id).first();
  if (!current || current.status !== 'active') return reply(request, { ok: false, error: 'Autorização permissiva ativa não encontrada.' }, 404);
  if (action === 'complete') await env.DB.prepare(`UPDATE permissive_authorizations SET status='completed',completed_at=?,completed_by_controller=?,completion_note=? WHERE id=?`).bind(now, controller.code, note || null, id).run();
  else if (action === 'cancel' && note.length >= 3) await env.DB.prepare(`UPDATE permissive_authorizations SET status='cancelled',cancelled_at=?,cancelled_by_controller=?,cancel_reason=? WHERE id=?`).bind(now, controller.code, note, id).run();
  else return reply(request, { ok: false, error: 'Ação inválida ou justificativa ausente.' }, 400);
  await env.DB.prepare('INSERT INTO permissive_events (id,permission_id,event_type,controller_code,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, action === 'complete' ? 'completed' : 'cancelled', controller.code, now, JSON.stringify({ note })).run();
  return reply(request, { ok: true });
}

async function adminRequesters(request, env, operation) {
  const body = await request.json().catch(() => ({}));
  if (!activeAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  if (operation === 'list') { const rows = await env.DB.prepare('SELECT code,name,role,company,supervisor,active,updated_at FROM requesters ORDER BY active DESC,name').all(); return reply(request, { ok: true, requesters: rows.results }); }
  const requesterCode = code(body.code), name = clean(body.name, 100), role = clean(body.role, 100), company = clean(body.company, 100), supervisor = clean(body.supervisor, 100);
  if (!requesterCode || name.length < 3) return reply(request, { ok: false, error: 'Código e nome são obrigatórios.' }, 400);
  if (operation === 'save') await env.DB.prepare(`INSERT INTO requesters (code,name,role,company,supervisor,active,updated_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name,role=excluded.role,company=excluded.company,supervisor=excluded.supervisor,updated_at=CURRENT_TIMESTAMP`).bind(requesterCode, name, role || null, company || null, supervisor || null).run();
  else await env.DB.prepare('UPDATE requesters SET active=?,updated_at=CURRENT_TIMESTAMP WHERE code=?').bind(body.active ? 1 : 0, requesterCode).run();
  return reply(request, { ok: true });
}

async function adminControllers(request, env, operation) {
  const body = await request.json().catch(() => ({}));
  if (!activeAuthorized(env, body.adminPassword)) return reply(request, { ok: false, error: 'Senha administrativa inválida.' }, 401);
  if (operation === 'list') { const rows = await env.DB.prepare('SELECT code,name,active,created_at,updated_at FROM cco_controllers ORDER BY active DESC,name').all(); return reply(request, { ok: true, controllers: rows.results }); }
  const controllerCode = code(body.code), name = clean(body.name, 100), pin = String(body.pin || '').trim();
  if (!controllerCode || name.length < 3) return reply(request, { ok: false, error: 'Código e nome são obrigatórios.' }, 400);
  if (operation === 'save') {
    const existing = await env.DB.prepare('SELECT code FROM cco_controllers WHERE code=?').bind(controllerCode).first();
    if (!existing && !/^\d{4,12}$/.test(pin)) return reply(request, { ok: false, error: 'Informe um PIN numérico de 4 a 12 dígitos.' }, 400);
    if (pin) { if (!/^\d{4,12}$/.test(pin)) return reply(request, { ok: false, error: 'PIN inválido.' }, 400); const salt = token(12); await env.DB.prepare(`INSERT INTO cco_controllers (code,name,pin_salt,pin_hash,active,updated_at) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,updated_at=CURRENT_TIMESTAMP`).bind(controllerCode, name, salt, await sha256(`${salt}:${pin}`)).run(); }
    else await env.DB.prepare('UPDATE cco_controllers SET name=?,updated_at=CURRENT_TIMESTAMP WHERE code=?').bind(name, controllerCode).run();
  } else { await env.DB.prepare('UPDATE cco_controllers SET active=?,updated_at=CURRENT_TIMESTAMP WHERE code=?').bind(body.active ? 1 : 0, controllerCode).run(); if (!body.active) await env.DB.prepare('DELETE FROM cco_sessions WHERE controller_code=?').bind(controllerCode).run(); }
  return reply(request, { ok: true });
}

export async function routeCco(request, env) {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path === '/api/v1/cco/login') return login(request, env);
  if (request.method === 'POST' && path.startsWith('/api/v2/admin/cco/requesters/')) return adminRequesters(request, env, path.endsWith('/list') ? 'list' : path.endsWith('/save') ? 'save' : 'status');
  if (request.method === 'POST' && path.startsWith('/api/v2/admin/cco/controllers/')) return adminControllers(request, env, path.endsWith('/list') ? 'list' : path.endsWith('/save') ? 'save' : 'status');
  if (request.method === 'GET' && path === '/api/v1/cco/public/operations') return publicOperations(request, env);
  if (!path.startsWith('/api/v1/cco/')) return null;
  const controller = await controllerAuth(request, env);
  if (!controller) return reply(request, { ok: false, error: 'Sessão do CCO inválida ou expirada.' }, 401);
  if (request.method === 'POST' && path === '/api/v1/cco/logout') return logout(request, env);
  if (request.method === 'GET' && path === '/api/v1/cco/state') return state(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/safety/sync') return syncSafetyEvents(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/ldl/create') return createLdl(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/ldl/close') return closeLdl(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/circulation/create') return createCirculation(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/circulation/close') return closeCirculation(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/permissive/create') return createPermissive(request, env, controller);
  if (request.method === 'POST' && path === '/api/v1/cco/permissive/close') return closePermissive(request, env, controller);
  return reply(request, { ok: false, error: 'Rota CCO não encontrada.' }, 404);
}
