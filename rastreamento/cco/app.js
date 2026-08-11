import { createSafetyAudio } from '../safety-audio.js?v=20260811-5';

const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../../mapa-superestrutura/assets/data/fico-axis-full.json';
const $ = (id) => document.getElementById(id);
const elements = {
  login: $('login'), app: $('app'), loginForm: $('login-form'), code: $('controller-code'), pin: $('controller-pin'),
  loginMessage: $('login-message'), controller: $('controller-name'), logout: $('logout'), refresh: $('refresh'), message: $('message'),
  sound: $('sound'), criticalBanner: $('critical-safety-banner'), criticalText: $('critical-safety-text'), safetyCount: $('safety-count'), safetyBody: $('safety-body'),
  freshness: $('freshness'), alerts: $('alerts'), alertCount: $('alert-count'), ldlList: $('ldl-list'), circulationList: $('circulation-list'), permissiveList: $('permissive-list'),
  historyBody: $('history-body'), historyFilter: $('history-filter'), pdf: $('pdf'), excel: $('excel'),
  kpiLdl: $('kpi-ldl'), kpiPeople: $('kpi-people'), kpiDeadline: $('kpi-deadline'), kpiCirculation: $('kpi-circulation'), kpiPermissive: $('kpi-permissive'), kpiApproach: $('kpi-approach'),
  ldlForm: $('ldl-form'), ldlRequester: $('ldl-requester'), ldlChannel: $('ldl-channel'), ldlKmStart: $('ldl-km-start'), ldlKmEnd: $('ldl-km-end'),
  ldlWorkforce: $('ldl-workforce'), ldlStart: $('ldl-start'), ldlEnd: $('ldl-end'), ldlDescription: $('ldl-description'), ldlMessage: $('ldl-message'),
  circulationForm: $('circulation-form'), circEquipment: $('circ-equipment'), circOperator: $('circ-operator'), circLine: $('circ-line'), circDirection: $('circ-direction'),
  circKmStart: $('circ-km-start'), circKmEnd: $('circ-km-end'), circStart: $('circ-start'), circEnd: $('circ-end'), circRestrictions: $('circ-restrictions'), circMessage: $('circ-message'),
  permissiveForm: $('permissive-form'), permEquipment: $('perm-equipment'), permOperator: $('perm-operator'), permLine: $('perm-line'), permKmStart: $('perm-km-start'), permKmEnd: $('perm-km-end'),
  permStart: $('perm-start'), permEnd: $('perm-end'), permChannel: $('perm-channel'), permDescription: $('perm-description'), permJustification: $('perm-justification'), permConflicts: $('perm-conflicts'), permConfirmed: $('perm-confirmed'), permMessage: $('perm-message')
};
let sessionToken = sessionStorage.getItem('ficoCcoToken') || '', state = null, axis = [], map, kmPopup, basemap = 'street', equipmentMarkers = new Map();
let loading = false, lastCriticalSignature = '', lastWarningSignature = '', lastCriticalSoundAt = 0;
const safetyAudio = createSafetyAudio(elements.sound, 'ficoCcoSafetySound');

function notify(element, text, success = false) {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('success', success);
}
function date(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function isoLocal(value) { const d = new Date(value); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function formatKm(meters) { const value = Math.max(0, Math.round(Number(meters))); return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, '0')}`; }
function parseKm(value) { const normalized = String(value).trim().replace(',', '.'); if (/^\d+\+\d{1,3}$/.test(normalized)) { const [km, m] = normalized.split('+'); return Number(km) * 1000 + Number(m); } const number = Number(normalized); return Number.isFinite(number) ? (number < 1000 ? number * 1000 : number) : null; }
function displayCode(item, prefix) { return `${prefix} ${String(item.sequence_number).padStart(3, '0')}`; }
function lineLabel(id) { return id === 'line01' ? 'Linha 01' : 'Linha 02'; }
function activeLdl() { return (state?.ldls || []).filter((item) => item.status === 'active'); }
function activeCirculations() { return (state?.circulations || []).filter((item) => item.status === 'authorized'); }
function activePermissives() { return (state?.permissives || []).filter((item) => item.status === 'active'); }
function activeSafetyEvents() { return (state?.safetyEvents || []).filter((item) => item.status === 'active'); }
function intervalsOverlap(aStart, aEnd, bStart, bEnd) { return aStart <= bEnd && aEnd >= bStart; }

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}), ...(options.headers || {}) }, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `Falha HTTP ${response.status}`); error.status = response.status; error.conflicts = data.conflicts; throw error; }
  return data;
}

function pointAtStation(target) {
  if (target <= axis[0].station_m) return axis[0].coordinate;
  if (target >= axis.at(-1).station_m) return axis.at(-1).coordinate;
  let low = 0, high = axis.length - 1;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (axis[middle].station_m <= target) low = middle; else high = middle; }
  const a = axis[low], b = axis[high], ratio = (target - a.station_m) / Math.max(1, b.station_m - a.station_m);
  return [a.coordinate[0] + ratio * (b.coordinate[0] - a.coordinate[0]), a.coordinate[1] + ratio * (b.coordinate[1] - a.coordinate[1])];
}
function sliceAxis(start, end) { return [pointAtStation(start), ...axis.filter((p) => p.station_m > start && p.station_m < end).map((p) => p.coordinate), pointAtStation(end)]; }
function projectToAxis(lon, lat) {
  let best = null; const cos = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < axis.length - 1; i++) {
    const a = axis[i], b = axis[i + 1], ax = (a.coordinate[0] - lon) * cos, ay = a.coordinate[1] - lat, bx = (b.coordinate[0] - lon) * cos, by = b.coordinate[1] - lat;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))), px = ax + t * dx, py = ay + t * dy, d2 = px * px + py * py;
    if (!best || d2 < best.d2) best = { d2, t, a, b, coordinate: [a.coordinate[0] + t * (b.coordinate[0] - a.coordinate[0]), a.coordinate[1] + t * (b.coordinate[1] - a.coordinate[1])] };
  }
  return best ? { stationM: best.a.station_m + best.t * (best.b.station_m - best.a.station_m), distanceM: Math.sqrt(best.d2) * 111320, coordinate: best.coordinate } : null;
}
function mapStyle() { return { version: 8, sources: {
  osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
  satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Esri World Imagery' }
}, layers: [
  { id: 'osm', type: 'raster', source: 'osm' },
  { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }
] }; }
function setBasemap(mode) {
  basemap = mode === 'satellite' ? 'satellite' : 'street';
  if (map?.getLayer('osm')) map.setLayoutProperty('osm', 'visibility', basemap === 'street' ? 'visible' : 'none');
  if (map?.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  document.querySelectorAll('[data-basemap]').forEach((button) => {
    const active = button.dataset.basemap === basemap;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function showKmReadout(lngLat) {
  const projection = projectToAxis(lngLat.lng, lngLat.lat); if (!projection) return;
  const content = document.createElement('div'); content.className = 'cco-km-popup';
  const line = document.createElement('span'); line.textContent = 'Linha 01 · eixo FICO';
  const km = document.createElement('strong'); km.textContent = `KM ${formatKm(projection.stationM)}`;
  const hint = document.createElement('small'); hint.textContent = 'Posição projetada sobre a ferrovia';
  content.append(line, km, hint);
  if (!kmPopup) kmPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
  kmPopup.setLngLat(lngLat).setDOMContent(content).addTo(map);
}
function initMap() {
  map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.3, attributionControl: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.on('load', () => {
    map.addSource('axis', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: axis.map((p) => p.coordinate) } } });
    map.addLayer({ id: 'axis-case', type: 'line', source: 'axis', paint: { 'line-color': '#fff', 'line-width': 8 } });
    map.addLayer({ id: 'axis', type: 'line', source: 'axis', paint: { 'line-color': '#082b4c', 'line-width': 4 } });
    map.addLayer({ id: 'axis-hit', type: 'line', source: 'axis', paint: { 'line-color': '#fff', 'line-width': 24, 'line-opacity': .01 } });
    map.addSource('operations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'operations', type: 'line', source: 'operations', paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': .9 } });
    map.addSource('permissives', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'permissives-case', type: 'line', source: 'permissives', paint: { 'line-color': '#082b4c', 'line-width': 12, 'line-opacity': .92 } });
    map.addLayer({ id: 'permissives', type: 'line', source: 'permissives', paint: { 'line-color': '#f4c430', 'line-width': 7, 'line-dasharray': [1.2, .8] } });
    map.on('click', 'operations', (event) => { const p = event.features[0].properties; new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<b>${p.code}</b><br>${p.line}<br>KM ${p.km}`).addTo(map); });
    map.on('click', 'permissives', (event) => { const p = event.features[0].properties; new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<b>${p.code}</b><br>OPERAÇÃO PERMISSIVA · 15 KM/H<br>${p.equipment}<br>${p.line}<br>KM ${p.km}`).addTo(map); });
    map.on('mouseenter', 'axis-hit', () => { map.getCanvas().style.cursor = 'crosshair'; });
    map.on('mousemove', 'axis-hit', (event) => showKmReadout(event.lngLat));
    map.on('mouseleave', 'axis-hit', () => { map.getCanvas().style.cursor = ''; kmPopup?.remove(); });
    setBasemap(basemap);
    renderMap();
  });
}
function renderMap() {
  if (!map?.getSource('operations') || !state) return;
  const now = Date.now(), features = [];
  for (const item of activeLdl()) if (item.lines.includes('line01')) features.push({ type: 'Feature', properties: { code: displayCode(item, 'LDL'), line: 'Linha 01', km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: Date.parse(item.requested_end) < now ? '#cf7a18' : '#c83f39' }, geometry: { type: 'LineString', coordinates: sliceAxis(item.km_start, item.km_end) } });
  for (const item of activeCirculations()) if (item.line_id === 'line01') features.push({ type: 'Feature', properties: { code: displayCode(item, 'CIRC'), line: 'Linha 01', km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: '#2b82c4' }, geometry: { type: 'LineString', coordinates: sliceAxis(item.km_start, item.km_end) } });
  map.getSource('operations').setData({ type: 'FeatureCollection', features });
  const permissiveFeatures = activePermissives().filter((item) => item.line_id === 'line01').map((item) => ({ type: 'Feature', properties: { code: displayCode(item, 'PERM'), equipment: item.equipment_id, line: 'Linha 01', km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}` }, geometry: { type: 'LineString', coordinates: sliceAxis(item.km_start, item.km_end) } }));
  map.getSource('permissives')?.setData({ type: 'FeatureCollection', features: permissiveFeatures });
  for (const item of state.latest || []) {
    const projection = projectToAxis(Number(item.longitude), Number(item.latitude)); if (!projection) continue;
    let marker = equipmentMarkers.get(item.equipment_id);
    if (!marker) { const el = document.createElement('div'); el.className = 'equipment-marker'; el.dataset.label = item.equipment_id; marker = new maplibregl.Marker({ element: el }).setLngLat(projection.coordinate).addTo(map); equipmentMarkers.set(item.equipment_id, marker); }
    marker.setLngLat(projection.coordinate); marker.getElement().title = `${item.equipment_id} · KM ${formatKm(projection.stationM)}`;
  }
}

function operationalAlerts() {
  const now = Date.now(), alerts = [], approaches = [];
  for (const event of activeSafetyEvents()) alerts.push({ danger: true, safety: true, title: `INVASÃO DE LDL · ${event.equipment_id}`, text: `${event.ldl_code} · KM ${formatKm(event.station_m)} · ${Number(event.speed_kmh || 0).toFixed(1).replace('.', ',')} km/h.` });
  for (const item of activeLdl()) {
    const remaining = (Date.parse(item.requested_end) - now) / 60000;
    if (remaining < 0) alerts.push({ danger: true, title: `${displayCode(item, 'LDL')} vencida`, text: `Devolução pendente desde ${date(item.requested_end)}. O trecho continua bloqueado.` });
    else if (remaining <= 15) alerts.push({ danger: true, title: `${displayCode(item, 'LDL')} termina em ${Math.ceil(remaining)} min`, text: `${item.requester_name} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}.` });
    else if (remaining <= 30) alerts.push({ title: `${displayCode(item, 'LDL')} termina em ${Math.ceil(remaining)} min`, text: `${item.requester_name} · confirmar devolução ou reprogramação.` });
  }
  for (const item of activePermissives()) {
    const remaining = (Date.parse(item.planned_end) - now) / 60000;
    if (remaining < 0) alerts.push({ danger: true, title: `${displayCode(item, 'PERM')} vencido`, text: `${item.equipment_id} permanece em operação permissiva até encerramento pelo CCO.` });
    else if (remaining <= 15) alerts.push({ danger: true, title: `${displayCode(item, 'PERM')} termina em ${Math.ceil(remaining)} min`, text: `${item.equipment_id} · limite obrigatório de 15 km/h.` });
    else if (remaining <= 30) alerts.push({ title: `${displayCode(item, 'PERM')} termina em ${Math.ceil(remaining)} min`, text: `Confirmar encerramento ou nova avaliação operacional.` });
  }
  for (const position of state.latest || []) {
    if (Date.now() - Date.parse(position.captured_at) > 120000) continue;
    const projection = projectToAxis(Number(position.longitude), Number(position.latitude));
    if (!projection || projection.distanceM > 100) continue;
    const equipmentPermissives = activePermissives().filter((item) => item.equipment_id === position.equipment_id && Date.parse(item.planned_start) <= now);
    for (const permission of equipmentPermissives) {
      const speedKmh = Number(position.speed_mps || 0) * 3.6;
      if (speedKmh > 15) alerts.push({ danger: true, title: `${permission.equipment_id} acima de 15 km/h`, text: `${displayCode(permission, 'PERM')} · velocidade recebida ${speedKmh.toFixed(1).replace('.', ',')} km/h.` });
    }
    for (const item of activeLdl().filter((ldl) => ldl.lines.includes('line01'))) {
      if (equipmentPermissives.some((permission) => permission.links?.some((link) => link.kind === 'LDL' && link.id === item.id))) continue;
      const distance = projection.stationM < item.km_start ? item.km_start - projection.stationM : projection.stationM > item.km_end ? projection.stationM - item.km_end : 0;
      if (distance <= 500 && distance > 0) { const alert = { danger: true, title: `${position.equipment_id} a ${Math.round(distance)} m de ${displayCode(item, 'LDL')}`, text: `Aproximação do trecho bloqueado na Linha 01.` }; alerts.push(alert); approaches.push(alert); }
    }
  }
  const deadlineCount = alerts.filter((item) => /termina|vencid[ao]/i.test(item.title)).length;
  return { alerts, approaches, deadlineCount };
}

function detectLdlIntrusions() {
  const detections = [], now = Date.now();
  for (const position of state?.latest || []) {
    if (now - Date.parse(position.captured_at) > 120000) continue;
    const projection = projectToAxis(Number(position.longitude), Number(position.latitude)); if (!projection || projection.distanceM > 100) continue;
    const permissions = activePermissives().filter((item) => item.equipment_id === position.equipment_id && Date.parse(item.planned_start) <= now);
    for (const ldl of activeLdl().filter((item) => item.lines.includes('line01'))) {
      if (projection.stationM < Number(ldl.km_start) || projection.stationM > Number(ldl.km_end)) continue;
      if (permissions.some((permission) => permission.links?.some((link) => link.kind === 'LDL' && link.id === ldl.id))) continue;
      detections.push({ equipmentId: position.equipment_id, ldlId: ldl.id, capturedAt: position.captured_at, stationM: projection.stationM, distanceM: projection.distanceM });
    }
  }
  return detections;
}
async function syncSafetyEvents() {
  const result = await api('/api/v1/cco/safety/sync', { method: 'POST', body: JSON.stringify({ detections: detectLdlIntrusions() }) });
  state.safetyEvents = result.events || [];
}

function renderSafetyEvents() {
  const events = state?.safetyEvents || [], active = activeSafetyEvents(); elements.safetyCount.textContent = active.length; elements.safetyBody.replaceChildren();
  for (const item of events) {
    const row = elements.safetyBody.insertRow(); row.classList.toggle('active', item.status === 'active');
    const status = row.insertCell(), badge = document.createElement('span'); badge.className = `safety-status ${item.status}`; badge.textContent = item.status === 'active' ? 'ATIVA' : 'ENCERRADA'; status.append(badge);
    [item.equipment_id, item.ldl_code, formatKm(item.station_m), `${Number(item.speed_kmh || 0).toFixed(1).replace('.', ',')} km/h`, date(item.first_seen_at), date(item.last_seen_at), item.occurrences].forEach((value) => { const cell = row.insertCell(); cell.textContent = value; });
  }
  if (!events.length) { const row = elements.safetyBody.insertRow(), cell = row.insertCell(); cell.colSpan = 8; cell.textContent = 'Nenhuma invasão de LDL registrada.'; }
  elements.criticalBanner.hidden = !active.length;
  elements.criticalText.textContent = active.map((item) => `${item.equipment_id} dentro de ${item.ldl_code} no KM ${formatKm(item.station_m)}`).join(' · ');
  if (active.length && safetyAudio.enabled) { const signature = active.map((item) => item.id).sort().join('|'); if (signature !== lastCriticalSignature || Date.now() - lastCriticalSoundAt >= 30000) { safetyAudio.critical(); lastCriticalSignature = signature; lastCriticalSoundAt = Date.now(); } }
  else lastCriticalSignature = '';
}

function populateSelects() {
  const currentRequester = elements.ldlRequester.value, currentEquipment = elements.circEquipment.value, currentPermEquipment = elements.permEquipment.value;
  elements.ldlRequester.replaceChildren();
  for (const item of state.requesters.filter((r) => r.active)) elements.ldlRequester.add(new Option(`${item.code} · ${item.name}`, item.code));
  elements.circEquipment.replaceChildren();
  for (const item of state.equipment) elements.circEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  elements.permEquipment.replaceChildren();
  for (const item of state.equipment) elements.permEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  elements.circOperator.replaceChildren(new Option('Não informado', ''));
  elements.permOperator.replaceChildren(new Option('Não informado', ''));
  for (const item of state.operators) elements.circOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  for (const item of state.operators) elements.permOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  if ([...elements.ldlRequester.options].some((o) => o.value === currentRequester)) elements.ldlRequester.value = currentRequester;
  if ([...elements.circEquipment.options].some((o) => o.value === currentEquipment)) elements.circEquipment.value = currentEquipment;
  if ([...elements.permEquipment.options].some((o) => o.value === currentPermEquipment)) elements.permEquipment.value = currentPermEquipment;
}

function permissiveConflictRecords() {
  if (!state) return { records: [], permissives: [] };
  const line = elements.permLine.value, kmStart = parseKm(elements.permKmStart.value), kmEnd = parseKm(elements.permKmEnd.value), start = Date.parse(elements.permStart.value), end = Date.parse(elements.permEnd.value);
  if (kmStart === null || kmEnd === null || kmEnd <= kmStart || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { records: [], permissives: [] };
  const effectiveEnd = (value) => Date.parse(value) < Date.now() ? Infinity : Date.parse(value);
  const records = [];
  for (const item of activeLdl()) if (item.lines.includes(line) && intervalsOverlap(kmStart, kmEnd, Number(item.km_start), Number(item.km_end)) && intervalsOverlap(start, end, Date.parse(item.requested_start), effectiveEnd(item.requested_end))) records.push({ kind: 'LDL', id: item.id, code: displayCode(item, 'LDL'), detail: `${item.requester_name} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}` });
  for (const item of activeCirculations()) if (item.line_id === line && intervalsOverlap(kmStart, kmEnd, Number(item.km_start), Number(item.km_end)) && intervalsOverlap(start, end, Date.parse(item.planned_start), effectiveEnd(item.planned_end))) records.push({ kind: 'CIRC', id: item.id, code: displayCode(item, 'CIRC'), detail: `${item.equipment_id} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}` });
  const permissives = activePermissives().filter((item) => item.line_id === line && intervalsOverlap(kmStart, kmEnd, Number(item.km_start), Number(item.km_end)) && intervalsOverlap(start, end, Date.parse(item.planned_start), effectiveEnd(item.planned_end)));
  return { records, permissives };
}

function renderPermissiveConflicts() {
  const { records, permissives } = permissiveConflictRecords();
  elements.permConflicts.replaceChildren();
  const legend = document.createElement('legend'); legend.textContent = 'Registros conflitantes vinculados'; elements.permConflicts.append(legend);
  if (permissives.length) { const blocked = document.createElement('div'); blocked.className = 'conflict-blocked'; blocked.textContent = `Não permitido: já existe ${permissives.map((item) => displayCode(item, 'PERM')).join(', ')} no mesmo trecho e período.`; elements.permConflicts.append(blocked); return; }
  if (!records.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Nenhum conflito encontrado. Neste caso, utilize a circulação normal.'; elements.permConflicts.append(empty); return; }
  for (const item of records) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'perm-record'; input.value = item.id; input.dataset.kind = item.kind; input.checked = true; label.append(input, document.createTextNode(`${item.code} · ${item.detail}`)); elements.permConflicts.append(label); }
}

function record(item, kind) {
  const isLdl = kind === 'ldl', isPermissive = kind === 'permissive', wrapper = document.createElement('article'); wrapper.className = `record ${isLdl ? '' : isPermissive ? 'permissive' : 'circulation'}`;
  const prefix = isLdl ? 'LDL' : isPermissive ? 'PERM' : 'CIRC';
  const codeText = displayCode(item, prefix), main = isLdl ? `${item.requester_name} · ${item.workforce_count} pessoas` : `${item.equipment_id} · ${item.operator_name || 'operador não informado'}`;
  const lines = isLdl ? item.lines.map(lineLabel).join(' + ') : lineLabel(item.line_id);
  wrapper.innerHTML = `<div class="code"></div><div><strong></strong><span></span><small></small></div><div class="record-actions"><button data-complete></button><button class="danger" data-cancel>CANCELAR</button></div>`;
  wrapper.querySelector('.code').textContent = codeText; wrapper.querySelector('strong').textContent = main; wrapper.querySelector('span').textContent = `${lines} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}${isPermissive ? ' · MÁX. 15 KM/H' : ''}`; wrapper.querySelector('small').textContent = `${date(isLdl ? item.requested_start : item.planned_start)} → ${date(isLdl ? item.requested_end : item.planned_end)}`;
  if (isPermissive) {
    const linkedLabels = (item.links || []).map((link) => { const source = link.kind === 'LDL' ? state.ldls.find((entry) => entry.id === link.id) : state.circulations.find((entry) => entry.id === link.id); return source ? displayCode(source, link.kind) : `${link.kind} vinculada`; });
    const details = document.createElement('details'); details.className = 'permission-details'; details.innerHTML = '<summary>VER CONDIÇÕES</summary><p></p>';
    details.querySelector('p').textContent = `Vinculado a ${linkedLabels.join(' + ')} · ${item.communication_channel === 'whatsapp' ? 'WhatsApp' : 'Rádio'} confirmado · Serviço: ${item.work_description} · Justificativa: ${item.justification}`;
    wrapper.children[1].append(details);
  }
  wrapper.querySelector('[data-complete]').textContent = isLdl ? 'REGISTRAR DEVOLUÇÃO' : isPermissive ? 'ENCERRAR PERMISSIVO' : 'CONCLUIR';
  wrapper.querySelector('[data-complete]').onclick = () => closeRecord(item.id, kind, isLdl ? 'return' : 'complete');
  wrapper.querySelector('[data-cancel]').onclick = () => closeRecord(item.id, kind, 'cancel');
  return wrapper;
}

function renderHistory() {
  const filter = elements.historyFilter.value, rows = [];
  if (filter === 'all' || filter === 'ldl') for (const item of state.ldls) rows.push({ code: displayCode(item, 'LDL'), status: item.status, owner: `${item.requester_name} · ${item.workforce_count} pessoas`, line: item.lines.map(lineLabel).join(' + '), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.requested_start, end: item.requested_end, controller: item.controller_name, time: item.created_at });
  if (filter === 'all' || filter === 'circulation') for (const item of state.circulations) rows.push({ code: displayCode(item, 'CIRC'), status: item.status, owner: `${item.equipment_id} · ${item.operator_name || '—'}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.planned_start, end: item.planned_end, controller: item.controller_name, time: item.authorized_at });
  if (filter === 'all' || filter === 'permissive') for (const item of state.permissives) rows.push({ code: displayCode(item, 'PERM'), status: item.status, owner: `${item.equipment_id} · 15 km/h · ${item.operator_name || '—'}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.planned_start, end: item.planned_end, controller: item.controller_name, time: item.authorized_at });
  rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)); elements.historyBody.replaceChildren();
  for (const item of rows) { const row = elements.historyBody.insertRow(); [item.code, item.status, item.owner, item.line, item.km, date(item.start), date(item.end), item.controller].forEach((value) => { const cell = row.insertCell(); cell.textContent = value; }); }
  if (!rows.length) { const row = elements.historyBody.insertRow(), cell = row.insertCell(); cell.colSpan = 8; cell.textContent = 'Nenhum registro no período.'; }
}

function render() {
  const ldls = activeLdl(), circulations = activeCirculations(), permissives = activePermissives(), { alerts, approaches, deadlineCount } = operationalAlerts();
  if (safetyAudio.enabled) { const warningSignature = alerts.filter((item) => !item.safety).map((item) => item.title).sort().join('|'); if (warningSignature && warningSignature !== lastWarningSignature) safetyAudio.warning(); lastWarningSignature = warningSignature; }
  elements.kpiLdl.textContent = ldls.length; elements.kpiPeople.textContent = ldls.reduce((sum, item) => sum + Number(item.workforce_count), 0); elements.kpiDeadline.textContent = deadlineCount; elements.kpiCirculation.textContent = circulations.length; elements.kpiPermissive.textContent = permissives.length; elements.kpiApproach.textContent = approaches.length;
  elements.alertCount.textContent = alerts.length; elements.alerts.replaceChildren();
  if (!alerts.length) elements.alerts.innerHTML = '<div class="empty">Nenhum alerta imediato.</div>';
  for (const item of alerts) { const node = document.createElement('div'); node.className = `alert ${item.danger ? 'danger' : ''}`; node.innerHTML = '<strong></strong><span></span>'; node.querySelector('strong').textContent = item.title; node.querySelector('span').textContent = item.text; elements.alerts.append(node); }
  elements.ldlList.replaceChildren(); for (const item of ldls) elements.ldlList.append(record(item, 'ldl')); if (!ldls.length) elements.ldlList.innerHTML = '<div class="empty">Nenhuma LDL em aberto.</div>';
  elements.circulationList.replaceChildren(); for (const item of circulations) elements.circulationList.append(record(item, 'circulation')); if (!circulations.length) elements.circulationList.innerHTML = '<div class="empty">Nenhuma circulação autorizada.</div>';
  elements.permissiveList.replaceChildren(); for (const item of permissives) elements.permissiveList.append(record(item, 'permissive')); if (!permissives.length) elements.permissiveList.innerHTML = '<div class="empty">Nenhuma operação permissiva ativa.</div>';
  elements.freshness.textContent = `Atualizado em ${date(state.serverTime)} · ciclo automático/5 s`; populateSelects(); renderHistory(); renderSafetyEvents(); renderMap();
}

async function load() {
  if (loading) return; loading = true;
  try { state = await api('/api/v1/cco/state'); await syncSafetyEvents(); elements.controller.textContent = `${state.controller.code} · ${state.controller.name}`; render(); }
  catch (error) { if (error.status === 401) return showLogin(); notify(elements.message, error.message); }
  finally { loading = false; }
}
function showLogin() { sessionToken = ''; sessionStorage.removeItem('ficoCcoToken'); elements.login.hidden = false; elements.app.hidden = true; elements.logout.hidden = true; elements.controller.textContent = 'AGUARDANDO ACESSO'; }
function showApp() { elements.login.hidden = true; elements.app.hidden = false; elements.logout.hidden = false; setTimeout(() => map?.resize(), 0); }

async function closeRecord(id, kind, action) {
  const isCancel = action === 'cancel', note = isCancel ? prompt('Informe a justificativa obrigatória do cancelamento:') : prompt(kind === 'ldl' ? 'Observação da devolução (opcional):' : kind === 'permissive' ? 'Observação do encerramento permissivo (opcional):' : 'Observação da conclusão (opcional):', '');
  if (note === null || (isCancel && note.trim().length < 3)) return;
  if (!confirm(`${action === 'return' ? 'Registrar devolução' : action === 'complete' ? 'Concluir circulação' : 'Cancelar registro'}?`)) return;
  try { await api(`/api/v1/cco/${kind === 'ldl' ? 'ldl' : kind === 'permissive' ? 'permissive' : 'circulation'}/close`, { method: 'POST', body: JSON.stringify({ id, action, note }) }); await load(); }
  catch (error) { notify(elements.message, error.message); }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.loginMessage, '');
  try { const data = await api('/api/v1/cco/login', { method: 'POST', body: JSON.stringify({ code: elements.code.value, pin: elements.pin.value }) }); sessionToken = data.token; sessionStorage.setItem('ficoCcoToken', sessionToken); elements.pin.value = ''; showApp(); await load(); }
  catch (error) { notify(elements.loginMessage, error.message); }
});
elements.logout.onclick = async () => { try { await api('/api/v1/cco/logout', { method: 'POST' }); } catch {} showLogin(); };
elements.refresh.onclick = load; elements.historyFilter.onchange = renderHistory; elements.pdf.onclick = () => window.print();
elements.excel.onclick = () => {
  if (!state) return; const rows = [['Código','Tipo','Situação','Responsável/Equipamento','Linha','KM inicial','KM final','Início','Fim','Controlador']];
  for (const item of state.ldls) rows.push([item.permanent_code,'LDL',item.status,`${item.requester_code} - ${item.requester_name}`,item.lines.map(lineLabel).join(' + '),formatKm(item.km_start),formatKm(item.km_end),item.requested_start,item.requested_end,item.controller_name]);
  for (const item of state.circulations) rows.push([item.permanent_code,'Circulação',item.status,item.equipment_id,lineLabel(item.line_id),formatKm(item.km_start),formatKm(item.km_end),item.planned_start,item.planned_end,item.controller_name]);
  for (const item of state.permissives) rows.push([item.permanent_code,'Permissivo 15 km/h',item.status,item.equipment_id,lineLabel(item.line_id),formatKm(item.km_start),formatKm(item.km_end),item.planned_start,item.planned_end,item.controller_name]);
  for (const item of state.safetyEvents || []) rows.push([item.id,'Invasão de LDL',item.status,item.equipment_id,'Linha 01',formatKm(item.station_m),formatKm(item.station_m),item.first_seen_at,item.last_seen_at,item.detected_by_controller]);
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';')).join('\r\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `controle-cco-${new Date().toISOString().slice(0,7)}.csv`; link.click(); URL.revokeObjectURL(url);
};

document.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => { const dialog = $(button.dataset.open), now = Date.now(); if (dialog.id === 'ldl-dialog') { elements.ldlStart.value = isoLocal(now); elements.ldlEnd.value = isoLocal(now + 4 * 3600000); } else if (dialog.id === 'circulation-dialog') { elements.circStart.value = isoLocal(now); elements.circEnd.value = isoLocal(now + 2 * 3600000); } else { elements.permStart.value = isoLocal(now); elements.permEnd.value = isoLocal(now + 2 * 3600000); renderPermissiveConflicts(); } dialog.showModal(); });
document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('[data-basemap]').forEach((button) => button.onclick = () => setBasemap(button.dataset.basemap));
elements.ldlForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.ldlMessage, ''); const lines = [...document.querySelectorAll('[name="ldl-line"]:checked')].map((item) => item.value);
  try { const data = await api('/api/v1/cco/ldl/create', { method: 'POST', body: JSON.stringify({ requesterCode: elements.ldlRequester.value, channel: elements.ldlChannel.value, kmStart: parseKm(elements.ldlKmStart.value), kmEnd: parseKm(elements.ldlKmEnd.value), lines, workforceCount: elements.ldlWorkforce.value, start: elements.ldlStart.value, end: elements.ldlEnd.value, description: elements.ldlDescription.value }) }); elements.ldlForm.closest('dialog').close(); notify(elements.message, `${data.ldl.displayCode} emitida com sucesso.`, true); elements.ldlForm.reset(); await load(); }
  catch (error) { notify(elements.ldlMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});
elements.circulationForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.circMessage, '');
  try { const data = await api('/api/v1/cco/circulation/create', { method: 'POST', body: JSON.stringify({ equipmentId: elements.circEquipment.value, operatorRegistration: elements.circOperator.value, line: elements.circLine.value, direction: elements.circDirection.value, kmStart: parseKm(elements.circKmStart.value), kmEnd: parseKm(elements.circKmEnd.value), start: elements.circStart.value, end: elements.circEnd.value, restrictions: elements.circRestrictions.value }) }); elements.circulationForm.closest('dialog').close(); notify(elements.message, `${data.circulation.displayCode} autorizada com sucesso.`, true); elements.circulationForm.reset(); await load(); }
  catch (error) { notify(elements.circMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});

for (const element of [elements.permLine, elements.permKmStart, elements.permKmEnd, elements.permStart, elements.permEnd]) element.addEventListener('input', renderPermissiveConflicts);
elements.permissiveForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.permMessage, '');
  const linkedRecords = [...document.querySelectorAll('[name="perm-record"]:checked')].map((item) => ({ kind: item.dataset.kind, id: item.value }));
  try {
    const data = await api('/api/v1/cco/permissive/create', { method: 'POST', body: JSON.stringify({ equipmentId: elements.permEquipment.value, operatorRegistration: elements.permOperator.value, line: elements.permLine.value, kmStart: parseKm(elements.permKmStart.value), kmEnd: parseKm(elements.permKmEnd.value), start: elements.permStart.value, end: elements.permEnd.value, channel: elements.permChannel.value, description: elements.permDescription.value, justification: elements.permJustification.value, communicationConfirmed: elements.permConfirmed.checked, linkedRecords }) });
    elements.permissiveForm.closest('dialog').close(); notify(elements.message, `${data.permissive.displayCode} emitido com limite obrigatório de 15 km/h.`, true); elements.permissiveForm.reset(); await load();
  } catch (error) { notify(elements.permMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); renderPermissiveConflicts(); }
});

setInterval(() => $('clock').textContent = new Date().toLocaleTimeString('pt-BR'), 1000);
fetch(AXIS_URL).then((response) => response.json()).then((data) => { axis = data.points; initMap(); if (sessionToken) { showApp(); load(); } }).catch((error) => notify(elements.loginMessage, `Traçado indisponível: ${error.message}`));
setInterval(() => { if (sessionToken) load(); }, 5000);
