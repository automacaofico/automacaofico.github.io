const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../../mapa-superestrutura/assets/data/fico-axis-full.json';
const $ = (id) => document.getElementById(id);
const elements = {
  login: $('login'), app: $('app'), loginForm: $('login-form'), code: $('controller-code'), pin: $('controller-pin'),
  loginMessage: $('login-message'), controller: $('controller-name'), logout: $('logout'), refresh: $('refresh'), message: $('message'),
  freshness: $('freshness'), alerts: $('alerts'), alertCount: $('alert-count'), ldlList: $('ldl-list'), circulationList: $('circulation-list'),
  historyBody: $('history-body'), historyFilter: $('history-filter'), pdf: $('pdf'), excel: $('excel'),
  kpiLdl: $('kpi-ldl'), kpiPeople: $('kpi-people'), kpiDeadline: $('kpi-deadline'), kpiCirculation: $('kpi-circulation'), kpiApproach: $('kpi-approach'),
  ldlForm: $('ldl-form'), ldlRequester: $('ldl-requester'), ldlChannel: $('ldl-channel'), ldlKmStart: $('ldl-km-start'), ldlKmEnd: $('ldl-km-end'),
  ldlWorkforce: $('ldl-workforce'), ldlStart: $('ldl-start'), ldlEnd: $('ldl-end'), ldlDescription: $('ldl-description'), ldlMessage: $('ldl-message'),
  circulationForm: $('circulation-form'), circEquipment: $('circ-equipment'), circOperator: $('circ-operator'), circLine: $('circ-line'), circDirection: $('circ-direction'),
  circKmStart: $('circ-km-start'), circKmEnd: $('circ-km-end'), circStart: $('circ-start'), circEnd: $('circ-end'), circRestrictions: $('circ-restrictions'), circMessage: $('circ-message')
};
let sessionToken = sessionStorage.getItem('ficoCcoToken') || '', state = null, axis = [], map, equipmentMarkers = new Map();

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
function mapStyle() { return { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] }; }
function initMap() {
  map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.3, attributionControl: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.on('load', () => {
    map.addSource('axis', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: axis.map((p) => p.coordinate) } } });
    map.addLayer({ id: 'axis-case', type: 'line', source: 'axis', paint: { 'line-color': '#fff', 'line-width': 8 } });
    map.addLayer({ id: 'axis', type: 'line', source: 'axis', paint: { 'line-color': '#082b4c', 'line-width': 4 } });
    map.addSource('operations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'operations', type: 'line', source: 'operations', paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': .9 } });
    map.on('click', 'operations', (event) => { const p = event.features[0].properties; new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<b>${p.code}</b><br>${p.line}<br>KM ${p.km}`).addTo(map); });
    renderMap();
  });
}
function renderMap() {
  if (!map?.getSource('operations') || !state) return;
  const now = Date.now(), features = [];
  for (const item of activeLdl()) if (item.lines.includes('line01')) features.push({ type: 'Feature', properties: { code: displayCode(item, 'LDL'), line: 'Linha 01', km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: Date.parse(item.requested_end) < now ? '#cf7a18' : '#c83f39' }, geometry: { type: 'LineString', coordinates: sliceAxis(item.km_start, item.km_end) } });
  for (const item of activeCirculations()) if (item.line_id === 'line01') features.push({ type: 'Feature', properties: { code: displayCode(item, 'CIRC'), line: 'Linha 01', km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: '#2b82c4' }, geometry: { type: 'LineString', coordinates: sliceAxis(item.km_start, item.km_end) } });
  map.getSource('operations').setData({ type: 'FeatureCollection', features });
  for (const item of state.latest || []) {
    const projection = projectToAxis(Number(item.longitude), Number(item.latitude)); if (!projection) continue;
    let marker = equipmentMarkers.get(item.equipment_id);
    if (!marker) { const el = document.createElement('div'); el.className = 'equipment-marker'; el.dataset.label = item.equipment_id; marker = new maplibregl.Marker({ element: el }).setLngLat(projection.coordinate).addTo(map); equipmentMarkers.set(item.equipment_id, marker); }
    marker.setLngLat(projection.coordinate); marker.getElement().title = `${item.equipment_id} · KM ${formatKm(projection.stationM)}`;
  }
}

function operationalAlerts() {
  const now = Date.now(), alerts = [], approaches = [];
  for (const item of activeLdl()) {
    const remaining = (Date.parse(item.requested_end) - now) / 60000;
    if (remaining < 0) alerts.push({ danger: true, title: `${displayCode(item, 'LDL')} vencida`, text: `Devolução pendente desde ${date(item.requested_end)}. O trecho continua bloqueado.` });
    else if (remaining <= 15) alerts.push({ danger: true, title: `${displayCode(item, 'LDL')} termina em ${Math.ceil(remaining)} min`, text: `${item.requester_name} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}.` });
    else if (remaining <= 30) alerts.push({ title: `${displayCode(item, 'LDL')} termina em ${Math.ceil(remaining)} min`, text: `${item.requester_name} · confirmar devolução ou reprogramação.` });
  }
  for (const position of state.latest || []) {
    if (Date.now() - Date.parse(position.captured_at) > 120000) continue;
    const projection = projectToAxis(Number(position.longitude), Number(position.latitude));
    if (!projection || projection.distanceM > 100) continue;
    for (const item of activeLdl().filter((ldl) => ldl.lines.includes('line01'))) {
      const distance = projection.stationM < item.km_start ? item.km_start - projection.stationM : projection.stationM > item.km_end ? projection.stationM - item.km_end : 0;
      if (distance <= 500) { const alert = { danger: true, title: `${position.equipment_id} a ${Math.round(distance)} m de ${displayCode(item, 'LDL')}`, text: `Aproximação do trecho bloqueado na Linha 01.` }; alerts.push(alert); approaches.push(alert); }
    }
  }
  return { alerts, approaches };
}

function populateSelects() {
  const currentRequester = elements.ldlRequester.value, currentEquipment = elements.circEquipment.value;
  elements.ldlRequester.replaceChildren();
  for (const item of state.requesters.filter((r) => r.active)) elements.ldlRequester.add(new Option(`${item.code} · ${item.name}`, item.code));
  elements.circEquipment.replaceChildren();
  for (const item of state.equipment) elements.circEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  elements.circOperator.replaceChildren(new Option('Não informado', ''));
  for (const item of state.operators) elements.circOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  if ([...elements.ldlRequester.options].some((o) => o.value === currentRequester)) elements.ldlRequester.value = currentRequester;
  if ([...elements.circEquipment.options].some((o) => o.value === currentEquipment)) elements.circEquipment.value = currentEquipment;
}

function record(item, kind) {
  const isLdl = kind === 'ldl', wrapper = document.createElement('article'); wrapper.className = `record ${isLdl ? '' : 'circulation'}`;
  const codeText = displayCode(item, isLdl ? 'LDL' : 'CIRC'), main = isLdl ? `${item.requester_name} · ${item.workforce_count} pessoas` : `${item.equipment_id} · ${item.operator_name || 'operador não informado'}`;
  const lines = isLdl ? item.lines.map(lineLabel).join(' + ') : lineLabel(item.line_id);
  wrapper.innerHTML = `<div class="code"></div><div><strong></strong><span></span><small></small></div><div class="record-actions"><button data-complete></button><button class="danger" data-cancel>CANCELAR</button></div>`;
  wrapper.querySelector('.code').textContent = codeText; wrapper.querySelector('strong').textContent = main; wrapper.querySelector('span').textContent = `${lines} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}`; wrapper.querySelector('small').textContent = `${date(isLdl ? item.requested_start : item.planned_start)} → ${date(isLdl ? item.requested_end : item.planned_end)}`;
  wrapper.querySelector('[data-complete]').textContent = isLdl ? 'REGISTRAR DEVOLUÇÃO' : 'CONCLUIR';
  wrapper.querySelector('[data-complete]').onclick = () => closeRecord(item.id, kind, isLdl ? 'return' : 'complete');
  wrapper.querySelector('[data-cancel]').onclick = () => closeRecord(item.id, kind, 'cancel');
  return wrapper;
}

function renderHistory() {
  const filter = elements.historyFilter.value, rows = [];
  if (filter !== 'circulation') for (const item of state.ldls) rows.push({ code: displayCode(item, 'LDL'), status: item.status, owner: `${item.requester_name} · ${item.workforce_count} pessoas`, line: item.lines.map(lineLabel).join(' + '), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.requested_start, end: item.requested_end, controller: item.controller_name, time: item.created_at });
  if (filter !== 'ldl') for (const item of state.circulations) rows.push({ code: displayCode(item, 'CIRC'), status: item.status, owner: `${item.equipment_id} · ${item.operator_name || '—'}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.planned_start, end: item.planned_end, controller: item.controller_name, time: item.authorized_at });
  rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)); elements.historyBody.replaceChildren();
  for (const item of rows) { const row = elements.historyBody.insertRow(); [item.code, item.status, item.owner, item.line, item.km, date(item.start), date(item.end), item.controller].forEach((value) => { const cell = row.insertCell(); cell.textContent = value; }); }
  if (!rows.length) { const row = elements.historyBody.insertRow(), cell = row.insertCell(); cell.colSpan = 8; cell.textContent = 'Nenhum registro no período.'; }
}

function render() {
  const ldls = activeLdl(), circulations = activeCirculations(), { alerts, approaches } = operationalAlerts();
  elements.kpiLdl.textContent = ldls.length; elements.kpiPeople.textContent = ldls.reduce((sum, item) => sum + Number(item.workforce_count), 0); elements.kpiDeadline.textContent = alerts.length - approaches.length; elements.kpiCirculation.textContent = circulations.length; elements.kpiApproach.textContent = approaches.length;
  elements.alertCount.textContent = alerts.length; elements.alerts.replaceChildren();
  if (!alerts.length) elements.alerts.innerHTML = '<div class="empty">Nenhum alerta imediato.</div>';
  for (const item of alerts) { const node = document.createElement('div'); node.className = `alert ${item.danger ? 'danger' : ''}`; node.innerHTML = '<strong></strong><span></span>'; node.querySelector('strong').textContent = item.title; node.querySelector('span').textContent = item.text; elements.alerts.append(node); }
  elements.ldlList.replaceChildren(); for (const item of ldls) elements.ldlList.append(record(item, 'ldl')); if (!ldls.length) elements.ldlList.innerHTML = '<div class="empty">Nenhuma LDL em aberto.</div>';
  elements.circulationList.replaceChildren(); for (const item of circulations) elements.circulationList.append(record(item, 'circulation')); if (!circulations.length) elements.circulationList.innerHTML = '<div class="empty">Nenhuma circulação autorizada.</div>';
  elements.freshness.textContent = `Atualizado em ${date(state.serverTime)} · ciclo manual/30 s`; populateSelects(); renderHistory(); renderMap();
}

async function load() {
  try { state = await api('/api/v1/cco/state'); elements.controller.textContent = `${state.controller.code} · ${state.controller.name}`; render(); }
  catch (error) { if (error.status === 401) return showLogin(); notify(elements.message, error.message); }
}
function showLogin() { sessionToken = ''; sessionStorage.removeItem('ficoCcoToken'); elements.login.hidden = false; elements.app.hidden = true; elements.logout.hidden = true; elements.controller.textContent = 'AGUARDANDO ACESSO'; }
function showApp() { elements.login.hidden = true; elements.app.hidden = false; elements.logout.hidden = false; setTimeout(() => map?.resize(), 0); }

async function closeRecord(id, kind, action) {
  const isCancel = action === 'cancel', note = isCancel ? prompt('Informe a justificativa obrigatória do cancelamento:') : prompt(kind === 'ldl' ? 'Observação da devolução (opcional):' : 'Observação da conclusão (opcional):', '');
  if (note === null || (isCancel && note.trim().length < 3)) return;
  if (!confirm(`${action === 'return' ? 'Registrar devolução' : action === 'complete' ? 'Concluir circulação' : 'Cancelar registro'}?`)) return;
  try { await api(`/api/v1/cco/${kind === 'ldl' ? 'ldl' : 'circulation'}/close`, { method: 'POST', body: JSON.stringify({ id, action, note }) }); await load(); }
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
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';')).join('\r\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `controle-cco-${new Date().toISOString().slice(0,7)}.csv`; link.click(); URL.revokeObjectURL(url);
};

document.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => { const dialog = $(button.dataset.open), now = Date.now(); if (dialog.id === 'ldl-dialog') { elements.ldlStart.value = isoLocal(now); elements.ldlEnd.value = isoLocal(now + 4 * 3600000); } else { elements.circStart.value = isoLocal(now); elements.circEnd.value = isoLocal(now + 2 * 3600000); } dialog.showModal(); });
document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => button.closest('dialog').close());
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

setInterval(() => $('clock').textContent = new Date().toLocaleTimeString('pt-BR'), 1000);
fetch(AXIS_URL).then((response) => response.json()).then((data) => { axis = data.points; initMap(); if (sessionToken) { showApp(); load(); } }).catch((error) => notify(elements.loginMessage, `Traçado indisponível: ${error.message}`));
setInterval(() => { if (sessionToken) load(); }, 30000);
