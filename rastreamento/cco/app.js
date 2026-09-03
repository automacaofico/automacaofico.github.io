import { createSafetyAudio } from '../safety-audio.js?v=20260811-5';
import { addInfrastructureLayers } from '../rail-infrastructure-map.js?v=20260811-2';
import { availableLines, lineCoordinates, LINE_LABELS } from '../rail-infrastructure.js?v=20260811-2';
import { RAIL_PACKAGES, packageAt, packageCollection } from '../rail-packages.js?v=20260811-1';
import { createCcoMotion } from './motion.js?v=20260820-1';

const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../../mapa-superestrutura/assets/data/fico-axis-full.json';
const STATUS_LABELS = { active: 'Ativa', returned: 'Devolvida', cancelled: 'Cancelada', authorized: 'Autorizada', completed: 'Concluída', resolved: 'Resolvida' };
const $ = (id) => document.getElementById(id);
const elements = {
  login: $('login'), app: $('app'), loginForm: $('login-form'), code: $('controller-code'), pin: $('controller-pin'),
  loginMessage: $('login-message'), controller: $('controller-name'), logout: $('logout'), refresh: $('refresh'), message: $('message'),
  sound: $('sound'), criticalBanner: $('critical-safety-banner'), criticalText: $('critical-safety-text'), safetyCount: $('safety-count'), safetyBody: $('safety-body'),
  freshness: $('freshness'), alerts: $('alerts'), alertCount: $('alert-count'), ldlList: $('ldl-list'), circulationList: $('circulation-list'), permissiveList: $('permissive-list'),
  historyBody: $('history-body'), historyFilter: $('history-filter'), pdf: $('pdf'), excel: $('excel'), ldlAuditExport: $('ldl-audit-export'), circAuditExport: $('circ-audit-export'),
  kpiLdl: $('kpi-ldl'), kpiPeople: $('kpi-people'), kpiDeadline: $('kpi-deadline'), kpiCirculation: $('kpi-circulation'), kpiPermissive: $('kpi-permissive'), kpiApproach: $('kpi-approach'),
  ldlForm: $('ldl-form'), ldlRequester: $('ldl-requester'), ldlChannel: $('ldl-channel'), ldlKmStart: $('ldl-km-start'), ldlKmEnd: $('ldl-km-end'), ldlTrackContext: $('ldl-track-context'),
  ldlWorkforce: $('ldl-workforce'), ldlStart: $('ldl-start'), ldlEnd: $('ldl-end'), ldlDescription: $('ldl-description'), ldlMessage: $('ldl-message'),
  ldlEditDialog: $('ldl-edit-dialog'), ldlEditForm: $('ldl-edit-form'), ldlEditCode: $('ldl-edit-code'), ldlEditRequester: $('ldl-edit-requester'), ldlEditChannel: $('ldl-edit-channel'), ldlEditKmStart: $('ldl-edit-km-start'), ldlEditKmEnd: $('ldl-edit-km-end'), ldlEditTrackContext: $('ldl-edit-track-context'), ldlEditWorkforce: $('ldl-edit-workforce'), ldlEditStart: $('ldl-edit-start'), ldlEditEnd: $('ldl-edit-end'), ldlEditDescription: $('ldl-edit-description'), ldlEditReason: $('ldl-edit-reason'), ldlEditMessage: $('ldl-edit-message'),
  ldlAuditDialog: $('ldl-audit-dialog'), ldlAuditTitle: $('ldl-audit-title'), ldlAuditSummary: $('ldl-audit-summary'), ldlAuditEvents: $('ldl-audit-events'),
  circulationForm: $('circulation-form'), circEquipment: $('circ-equipment'), circOperator: $('circ-operator'), circLine: $('circ-line'), circDirection: $('circ-direction'), circTrackContext: $('circ-track-context'),
  circKmStart: $('circ-km-start'), circKmEnd: $('circ-km-end'), circStart: $('circ-start'), circEnd: $('circ-end'), circEquipmentList: $('circ-equipment-list'), circAddEquipment: $('circ-add-equipment'), circCompositionList: $('circ-composition-list'), circAddConsist: $('circ-add-consist'), circRestrictions: $('circ-restrictions'), circMessage: $('circ-message'),
  circEditDialog: $('circ-edit-dialog'), circEditForm: $('circ-edit-form'), circEditCode: $('circ-edit-code'), circEditEquipment: $('circ-edit-equipment'), circEditOperator: $('circ-edit-operator'), circEditLine: $('circ-edit-line'), circEditDirection: $('circ-edit-direction'), circEditTrackContext: $('circ-edit-track-context'), circEditKmStart: $('circ-edit-km-start'), circEditKmEnd: $('circ-edit-km-end'), circEditStart: $('circ-edit-start'), circEditEnd: $('circ-edit-end'), circEditEquipmentList: $('circ-edit-equipment-list'), circEditAddEquipment: $('circ-edit-add-equipment'), circEditCompositionList: $('circ-edit-composition-list'), circEditAddConsist: $('circ-edit-add-consist'), circEditRestrictions: $('circ-edit-restrictions'), circEditReason: $('circ-edit-reason'), circEditMessage: $('circ-edit-message'),
  circAuditDialog: $('circ-audit-dialog'), circAuditTitle: $('circ-audit-title'), circAuditSummary: $('circ-audit-summary'), circAuditEvents: $('circ-audit-events'),
  permissiveForm: $('permissive-form'), permEquipment: $('perm-equipment'), permOperator: $('perm-operator'), permLine: $('perm-line'), permKmStart: $('perm-km-start'), permKmEnd: $('perm-km-end'), permTrackContext: $('perm-track-context'),
  permStart: $('perm-start'), permEnd: $('perm-end'), permChannel: $('perm-channel'), permDescription: $('perm-description'), permJustification: $('perm-justification'), permConflicts: $('perm-conflicts'), permConfirmed: $('perm-confirmed'), permMessage: $('perm-message')
};
let sessionToken = sessionStorage.getItem('ficoCcoToken') || '', state = null, axis = [], map, kmPopup, operationPopup, equipmentPopup, basemap = 'street', equipmentMarkers = new Map(), packageMarkers = [];
let loading = false, editingLdl = null, editingCirculation = null, lastCriticalSignature = '', lastWarningSignature = '', lastCriticalSoundAt = 0;
let refreshTimer = null, refreshFailures = 0;
const safetyAudio = createSafetyAudio(elements.sound, 'ficoCcoSafetySound');
const ccoMotion = createCcoMotion({ toggle: $('reduce-motion-toggle') });

function notify(element, text, success = false) {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('success', success);
  ccoMotion.notice(element, success);
}
function date(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function isoLocal(value) { const d = new Date(value); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function ccoLocalToIso(value) {
  const local = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local)) return local;
  return new Date(`${local}-03:00`).toISOString();
}
function formatKm(meters) { const value = Math.max(0, Math.round(Number(meters))); return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, '0')}`; }
function parseKm(value) { const normalized = String(value).trim().replace(',', '.'); if (/^\d+\+\d{1,3}$/.test(normalized)) { const [km, m] = normalized.split('+'); return Number(km) * 1000 + Number(m); } const number = Number(normalized); return Number.isFinite(number) ? (number < 1000 ? number * 1000 : number) : null; }
function displayCode(item, prefix) { return `${prefix} ${String(item.sequence_number).padStart(3, '0')}`; }
function lineLabel(id) { return LINE_LABELS[id] || id; }
function activeLdl() { return (state?.ldls || []).filter((item) => item.status === 'active'); }
function activeCirculations() { return (state?.circulations || []).filter((item) => item.status === 'authorized'); }
function activePermissives() { return (state?.permissives || []).filter((item) => item.status === 'active'); }
function activeSafetyEvents() { return (state?.safetyEvents || []).filter((item) => item.status === 'active'); }
function intervalsOverlap(aStart, aEnd, bStart, bEnd) { return aStart <= bEnd && aEnd >= bStart; }
function memberRoleLabel(role) { return role === 'traction_auxiliary' ? 'auxiliar de tração' : 'rebocado'; }
function tractionLabel(item) { return `${item.equipment_id} (comandante)${(item.equipmentMembers || []).map((member) => ` + ${member.equipmentId} (${memberRoleLabel(member.operationalRole)})`).join('')}`; }
function compositionLabel(item) {
  const groups = Array.isArray(item?.composition) ? item.composition : [];
  if (!groups.length) return 'Sem vagões / escoteira';
  return groups.map((group) => `${group.wagonCount} ${group.wagonType} ${group.loadStatus === 'loaded' ? `carregados · ${group.cargoDescription}` : 'vazios'}`).join(' + ');
}

function updateCompositionEditor(container) {
  const rows = [...container.querySelectorAll('.composition-row')];
  container.querySelector('.composition-empty')?.remove();
  if (!rows.length) {
    const empty = document.createElement('div'); empty.className = 'composition-empty'; empty.textContent = 'Sem grupos cadastrados · circulação escoteira'; container.append(empty);
  }
  let totals = container.parentElement.querySelector('.composition-totals');
  if (!totals) { totals = document.createElement('div'); totals.className = 'composition-totals'; container.after(totals); }
  const composition = readComposition(container), total = composition.reduce((sum, item) => sum + Number(item.wagonCount || 0), 0), loaded = composition.filter((item) => item.loadStatus === 'loaded').reduce((sum, item) => sum + Number(item.wagonCount || 0), 0);
  totals.textContent = total ? `${total} vagões no total · ${loaded} carregados · ${total - loaded} vazios` : 'Trem escoteiro';
}

function addCompositionRow(container, item = {}) {
  container.querySelector('.composition-empty')?.remove();
  const row = document.createElement('div'); row.className = 'composition-row';
  row.innerHTML = `<label>Tipo<select data-wagon-type aria-label="Tipo de vagão"><option>HNS</option><option>HNT</option><option>PET</option><option>PNT</option><option>PES</option></select></label><label>Quantidade<input data-wagon-count aria-label="Quantidade de vagões" type="number" min="1" max="500" required></label><label>Condição<select data-load-status aria-label="Condição dos vagões"><option value="loaded">Carregado</option><option value="empty">Vazio</option></select></label><label class="cargo-field">Carga transportada<input data-cargo aria-label="Carga transportada" maxlength="300" placeholder="Ex.: brita, trilhos, dormentes"></label><button type="button" class="remove-consist" aria-label="Remover grupo">×</button>`;
  row.querySelector('[data-wagon-type]').value = item.wagonType || 'HNS'; row.querySelector('[data-wagon-count]').value = Number(item.wagonCount || 1); row.querySelector('[data-load-status]').value = item.loadStatus || 'loaded'; row.querySelector('[data-cargo]').value = item.cargoDescription || '';
  const syncCargo = () => { const loaded = row.querySelector('[data-load-status]').value === 'loaded', input = row.querySelector('[data-cargo]'); input.disabled = !loaded; input.required = loaded; if (!loaded) input.value = ''; updateCompositionEditor(container); };
  row.querySelector('[data-load-status]').addEventListener('change', syncCargo); row.querySelector('[data-wagon-count]').addEventListener('input', () => updateCompositionEditor(container)); row.querySelector('.remove-consist').onclick = () => { row.remove(); updateCompositionEditor(container); };
  container.append(row); syncCargo();
  ccoMotion.added(row);
}

function renderCompositionEditor(container, composition = []) {
  container.replaceChildren();
  for (const item of composition) addCompositionRow(container, item);
  updateCompositionEditor(container);
}

function readComposition(container) {
  return [...container.querySelectorAll('.composition-row')].map((row) => ({ wagonType: row.querySelector('[data-wagon-type]').value, wagonCount: Number(row.querySelector('[data-wagon-count]').value), loadStatus: row.querySelector('[data-load-status]').value, cargoDescription: row.querySelector('[data-cargo]').value.trim() }));
}

function updateEquipmentFormationEditor(container) {
  const rows = [...container.querySelectorAll('.equipment-member-row')];
  container.querySelector('.composition-empty')?.remove();
  if (!rows.length) { const empty = document.createElement('div'); empty.className = 'composition-empty'; empty.textContent = 'Nenhum equipamento acoplado'; container.append(empty); }
  let summary = container.parentElement.querySelector('.formation-summary');
  if (!summary) { summary = document.createElement('div'); summary.className = 'formation-summary'; container.after(summary); }
  const members = readEquipmentMembers(container), auxiliary = members.filter((item) => item.operationalRole === 'traction_auxiliary').length, towed = members.length - auxiliary;
  summary.textContent = members.length ? `${members.length} acoplado${members.length === 1 ? '' : 's'} · ${auxiliary} auxiliar${auxiliary === 1 ? '' : 'es'} de tração · ${towed} rebocado${towed === 1 ? '' : 's'}` : 'Somente o equipamento comandante';
}

function addEquipmentMemberRow(container, item = {}) {
  container.querySelector('.composition-empty')?.remove();
  const row = document.createElement('div'); row.className = 'equipment-member-row';
  row.innerHTML = `<label>Equipamento<select data-member-equipment aria-label="Equipamento acoplado"></select></label><label>Função na formação<select data-member-role aria-label="Função do equipamento acoplado"><option value="traction_auxiliary">Auxiliar de tração</option><option value="towed">Rebocado</option></select></label><button type="button" class="remove-equipment" aria-label="Remover equipamento acoplado">×</button>`;
  const select = row.querySelector('[data-member-equipment]');
  for (const equipment of state?.equipment || []) select.add(new Option(`${equipment.id} · ${equipment.name}`, equipment.id));
  if (item.equipmentId && [...select.options].some((option) => option.value === item.equipmentId)) select.value = item.equipmentId;
  row.querySelector('[data-member-role]').value = item.operationalRole || 'towed';
  row.querySelector('[data-member-role]').addEventListener('change', () => updateEquipmentFormationEditor(container));
  row.querySelector('.remove-equipment').onclick = () => { row.remove(); updateEquipmentFormationEditor(container); };
  container.append(row); updateEquipmentFormationEditor(container);
  ccoMotion.added(row);
}

function renderEquipmentFormationEditor(container, members = []) {
  container.replaceChildren();
  for (const item of members) addEquipmentMemberRow(container, item);
  updateEquipmentFormationEditor(container);
}

function readEquipmentMembers(container) {
  return [...container.querySelectorAll('.equipment-member-row')].map((row) => ({ equipmentId: row.querySelector('[data-member-equipment]').value, operationalRole: row.querySelector('[data-member-role]').value }));
}

function updateTrackContext(kind) {
  const config = kind === 'ldl'
    ? { start: elements.ldlKmStart, end: elements.ldlKmEnd, context: elements.ldlTrackContext, select: null, checkboxes: '[name="ldl-line"]' }
    : kind === 'edit-ldl'
      ? { start: elements.ldlEditKmStart, end: elements.ldlEditKmEnd, context: elements.ldlEditTrackContext, select: null, checkboxes: '[name="edit-ldl-line"]' }
    : kind === 'circulation'
      ? { start: elements.circKmStart, end: elements.circKmEnd, context: elements.circTrackContext, select: elements.circLine, directional: true }
      : kind === 'edit-circulation'
        ? { start: elements.circEditKmStart, end: elements.circEditKmEnd, context: elements.circEditTrackContext, select: elements.circEditLine, directional: true }
      : { start: elements.permKmStart, end: elements.permKmEnd, context: elements.permTrackContext, select: elements.permLine };
  const start = parseKm(config.start.value), end = parseKm(config.end.value);
  const intervalStart = config.directional && start !== null && end !== null ? Math.min(start, end) : start;
  const intervalEnd = config.directional && start !== null && end !== null ? Math.max(start, end) : end;
  const availability = intervalStart === null || intervalEnd === null || intervalEnd <= intervalStart ? { lines: ['line01'], structures: [], partialStructures: [] } : availableLines(intervalStart, intervalEnd);
  const validInterval = intervalStart !== null && intervalEnd !== null && intervalEnd > intervalStart;
  if (!validInterval) config.context.textContent = 'Informe o trecho para verificar as linhas disponíveis.';
  else if (availability.structures.length) config.context.textContent = `Disponíveis neste trecho: ${availability.lines.map(lineLabel).join(' · ')}. Estrutura: ${availability.structures.map((item) => `${item.name}${item.provisional ? ' (provisória)' : ''}`).join(' + ')}.`;
  else if (availability.partialStructures.length && config.select?.value === 'line01') config.context.textContent = `Linha 01 disponível em todo o trecho. O percurso cruza ${availability.partialStructures.map((item) => item.name).join(' + ')}; Linha 02 e linhas especiais só podem ser usadas dentro de seus limites.`;
  else if (availability.partialStructures.length) config.context.textContent = `O trecho atravessa o limite de ${availability.partialStructures.map((item) => item.name).join(' + ')}. Divida a autorização para usar Linha 02 ou linha especial.`;
  else config.context.textContent = 'Trecho em linha singela · somente Linha 01 disponível.';
  config.context.classList.toggle('warning', validInterval && availability.partialStructures.length > 0 && (!config.select || config.select.value !== 'line01'));
  if (config.checkboxes) {
    for (const checkbox of document.querySelectorAll(config.checkboxes)) {
      if (checkbox.value === 'line01') continue;
      checkbox.disabled = !availability.lines.includes(checkbox.value);
      if (checkbox.disabled) checkbox.checked = false;
    }
  } else {
    for (const option of config.select.options) if (option.value !== 'line01') option.disabled = !availability.lines.includes(option.value);
    if (!availability.lines.includes(config.select.value)) config.select.value = 'line01';
  }
}

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

function addPackageMarkers() {
  packageMarkers.forEach((marker) => marker.remove());
  packageMarkers = RAIL_PACKAGES.map((item) => {
    const element = document.createElement('div'); element.className = 'cco-package-map-label'; element.textContent = item.id; element.style.setProperty('--package', item.color);
    element.title = `${item.name} · KM ${formatKm(item.start)} — ${formatKm(item.end)}`;
    return new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(pointAtStation((item.start + item.end) / 2)).addTo(map);
  });
}

function focusPackage(packageId) {
  const selected = RAIL_PACKAGES.find((item) => item.id === packageId); if (!selected || !map) return;
  const bounds = new maplibregl.LngLatBounds(); sliceAxis(selected.start, selected.end).forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 55 : 105, maxZoom: 14, duration: 900 });
  document.querySelectorAll('[data-package]').forEach((button) => { const active = button.dataset.package === packageId; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
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
  const line = document.createElement('span'); line.textContent = `${packageAt(projection.stationM).name} · eixo FICO`;
  const km = document.createElement('strong'); km.textContent = `KM ${formatKm(projection.stationM)}`;
  const hint = document.createElement('small'); hint.textContent = 'Posição projetada sobre a ferrovia';
  content.append(line, km, hint);
  if (!kmPopup) kmPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
  kmPopup.setLngLat(lngLat).setDOMContent(content).addTo(map);
}

function findMapOperation(kind, id) {
  if (kind === 'ldl') return activeLdl().find((item) => item.id === id);
  if (kind === 'circulation') return activeCirculations().find((item) => item.id === id);
  return activePermissives().find((item) => item.id === id);
}

function operationPopupContent(item, kind) {
  const card = document.createElement('article'); card.className = `cco-operation-popup-card ${kind}`;
  const header = document.createElement('header'), code = document.createElement('strong'), badge = document.createElement('span');
  code.textContent = displayCode(item, kind === 'ldl' ? 'LDL' : kind === 'circulation' ? 'CIRC' : 'PERM');
  badge.textContent = kind === 'ldl' ? 'TRECHO BLOQUEADO' : kind === 'circulation' ? 'CIRCULAÇÃO AUTORIZADA' : 'PERMISSIVO · 15 KM/H';
  header.append(code, badge);
  const body = document.createElement('div'); body.className = 'cco-operation-popup-body';
  const km = document.createElement('b'); km.textContent = `KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}`;
  const line = document.createElement('span'); line.textContent = kind === 'ldl' ? item.lines.map(lineLabel).join(' + ') : lineLabel(item.line_id);
  const main = document.createElement('strong');
  main.textContent = kind === 'ldl' ? `${item.requester_code} · ${item.requester_name}` : kind === 'circulation' ? `${tractionLabel(item)} · ${item.equipment_name}` : `${item.equipment_id} · ${item.equipment_name}`;
  const detail = document.createElement('small');
  detail.textContent = kind === 'ldl'
    ? `${item.workforce_count} pessoas · Serviço: ${item.work_description}`
    : kind === 'circulation'
      ? `Sentido: ${item.direction} · Operador: ${item.operator_name || 'não informado'} · ${compositionLabel(item)}${item.restrictions ? ` · Restrições: ${item.restrictions}` : ''}`
      : `Operador: ${item.operator_name || 'não informado'} · Serviço: ${item.work_description} · ${item.justification}`;
  const period = document.createElement('small'); period.textContent = `${date(kind === 'ldl' ? item.requested_start : item.planned_start)} → ${date(kind === 'ldl' ? item.requested_end : item.planned_end)}`;
  body.append(km, line, main, detail, period); card.append(header, body); return card;
}

function showOperationPopup(item, kind, lngLat) {
  if (!item || !map) return;
  kmPopup?.remove(); map.getCanvas().style.cursor = 'pointer';
  if (!operationPopup) operationPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, className: 'cco-operation-popup' });
  operationPopup.setLngLat(lngLat).setDOMContent(operationPopupContent(item, kind)).addTo(map);
}

function showOperationHover(event) {
  const feature = event.features?.[0]; if (!feature) return;
  const item = findMapOperation(feature.properties.kind, feature.properties.id); if (!item) return;
  showOperationPopup(item, feature.properties.kind, event.lngLat);
}

function focusMapOperation(item, kind) {
  if (!map || !axis.length) return;
  const start = Number(item.km_start), end = Number(item.km_end), helpers = { sliceAxis, pointAtStation };
  const lineIds = kind === 'ldl' ? item.lines : [item.line_id];
  const coordinateSets = lineIds.map((lineId) => lineCoordinates(lineId, start, end, helpers));
  const bounds = new maplibregl.LngLatBounds();
  coordinateSets.flat().forEach((coordinate) => bounds.extend(coordinate));
  const centerCoordinates = coordinateSets[0] || [];
  const center = centerCoordinates[Math.floor(centerCoordinates.length / 2)] || pointAtStation((start + end) / 2);
  const mapCard = document.querySelector('.map-card');
  mapCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  mapCard?.classList.remove('map-focus-pulse');
  requestAnimationFrame(() => mapCard?.classList.add('map-focus-pulse'));
  ccoMotion.mapFocus();
  window.setTimeout(() => {
    map.resize();
    map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 55 : 110, maxZoom: 14, duration: 850 });
    window.setTimeout(() => showOperationPopup(item, kind, center), 880);
  }, 260);
  window.setTimeout(() => mapCard?.classList.remove('map-focus-pulse'), 1500);
}

function showEquipmentPopup(item, projection) {
  const equipment = state.equipment.find((entry) => entry.id === item.equipment_id), circulation = activeCirculations().find((entry) => entry.equipment_id === item.equipment_id || (entry.equipmentMembers || []).some((member) => member.equipmentId === item.equipment_id));
  const card = document.createElement('article'); card.className = 'cco-equipment-popup-card';
  const header = document.createElement('header'), name = document.createElement('strong'), badge = document.createElement('span'); name.textContent = item.equipment_id; badge.textContent = 'POSIÇÃO GPS'; header.append(name, badge);
  const body = document.createElement('div'); body.className = 'cco-operation-popup-body';
  const km = document.createElement('b'); km.textContent = `KM ${formatKm(projection.stationM)}`;
  const alias = document.createElement('strong'); alias.textContent = equipment?.name || item.equipment_id;
  const detail = document.createElement('small'); detail.textContent = `${equipment?.description || equipment?.type || 'Equipamento ferroviário'} · ${Number(item.speed_mps || 0) * 3.6 < .5 ? 'parado' : `${(Number(item.speed_mps) * 3.6).toFixed(1).replace('.', ',')} km/h`}`;
  const operator = document.createElement('small'); operator.textContent = `Operador: ${circulation?.operator_name || 'não informado'} · Sinal: ${date(item.captured_at)}`;
  const formation = document.createElement('small'); formation.textContent = circulation ? `Formação: ${tractionLabel(circulation)}` : 'Sem circulação vinculada';
  const consist = document.createElement('small'); consist.textContent = circulation ? compositionLabel(circulation) : '';
  body.append(km, alias, detail, operator, formation, consist); card.append(header, body);
  if (!equipmentPopup) equipmentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 20, className: 'cco-equipment-popup' });
  equipmentPopup.setLngLat(projection.coordinate).setDOMContent(card).addTo(map);
}
function initMap() {
  map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.3, attributionControl: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.on('load', () => {
    map.addSource('axis', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: axis.map((p) => p.coordinate) } } });
    map.addLayer({ id: 'axis-case', type: 'line', source: 'axis', paint: { 'line-color': '#fff', 'line-width': 8 } });
    map.addLayer({ id: 'axis', type: 'line', source: 'axis', paint: { 'line-color': '#082b4c', 'line-width': 4 } });
    map.addSource('packages', { type: 'geojson', data: packageCollection(sliceAxis, axis.at(-1).station_m) });
    map.addLayer({ id: 'package-casing', type: 'line', source: 'packages', paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 14, 11], 'line-opacity': .92 } });
    map.addLayer({ id: 'package-lines', type: 'line', source: 'packages', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 14, 7], 'line-opacity': .96 } });
    map.addLayer({ id: 'package-hit', type: 'line', source: 'packages', paint: { 'line-color': '#fff', 'line-width': 24, 'line-opacity': .01 } });
    const infrastructure = addInfrastructureLayers(map, { sliceAxis, pointAtStation });
    map.addSource('operations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'operations', type: 'line', source: 'operations', paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': .9 } });
    map.addSource('permissives', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'permissives-case', type: 'line', source: 'permissives', paint: { 'line-color': '#082b4c', 'line-width': 12, 'line-opacity': .92 } });
    map.addLayer({ id: 'permissives', type: 'line', source: 'permissives', paint: { 'line-color': '#f4c430', 'line-width': 7, 'line-dasharray': [1.2, .8] } });
    addPackageMarkers();
    map.on('mouseenter', 'package-hit', () => { map.getCanvas().style.cursor = 'crosshair'; });
    map.on('mousemove', 'package-hit', (event) => {
      const priorityLayers = ['operations', 'permissives', ...infrastructure.layers].filter((layer) => map.getLayer(layer));
      const priorityFeatures = map.queryRenderedFeatures(event.point, { layers: priorityLayers });
      if (priorityFeatures.length) { kmPopup?.remove(); return; }
      showKmReadout(event.lngLat);
    });
    map.on('mouseleave', 'package-hit', () => { map.getCanvas().style.cursor = ''; kmPopup?.remove(); });
    for (const layer of ['operations', 'permissives']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mousemove', layer, showOperationHover);
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; operationPopup?.remove(); });
      map.on('click', layer, showOperationHover);
    }
    setBasemap(basemap);
    renderMap();
  });
}
function renderMap() {
  if (!map?.getSource('operations') || !state) return;
  const now = Date.now(), features = [];
  const helpers = { sliceAxis, pointAtStation };
  for (const item of activeLdl()) for (const lineId of item.lines) features.push({ type: 'Feature', properties: { id: item.id, kind: 'ldl', code: displayCode(item, 'LDL'), line: lineLabel(lineId), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: Date.parse(item.requested_end) < now ? '#cf7a18' : '#c83f39' }, geometry: { type: 'LineString', coordinates: lineCoordinates(lineId, item.km_start, item.km_end, helpers) } });
  for (const item of activeCirculations()) features.push({ type: 'Feature', properties: { id: item.id, kind: 'circulation', code: displayCode(item, 'CIRC'), line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, color: '#2b82c4' }, geometry: { type: 'LineString', coordinates: lineCoordinates(item.line_id, item.km_start, item.km_end, helpers) } });
  map.getSource('operations').setData({ type: 'FeatureCollection', features });
  const permissiveFeatures = activePermissives().map((item) => ({ type: 'Feature', properties: { id: item.id, kind: 'permissive', code: displayCode(item, 'PERM'), equipment: item.equipment_id, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}` }, geometry: { type: 'LineString', coordinates: lineCoordinates(item.line_id, item.km_start, item.km_end, helpers) } }));
  map.getSource('permissives')?.setData({ type: 'FeatureCollection', features: permissiveFeatures });
  const coupledIds = new Set(activeCirculations().flatMap((circulation) => (circulation.equipmentMembers || []).map((member) => member.equipmentId)));
  for (const item of state.latest || []) {
    if (coupledIds.has(item.equipment_id)) { equipmentMarkers.get(item.equipment_id)?.remove(); equipmentMarkers.delete(item.equipment_id); continue; }
    const projection = projectToAxis(Number(item.longitude), Number(item.latitude)); if (!projection) continue;
    let marker = equipmentMarkers.get(item.equipment_id);
    if (!marker) {
      const el = document.createElement('div'); el.className = 'equipment-marker'; el.dataset.label = item.equipment_id; el.tabIndex = 0; el.setAttribute('role', 'button');
      const show = () => { const current = state.latest.find((entry) => entry.equipment_id === item.equipment_id); if (!current) return; const currentProjection = projectToAxis(Number(current.longitude), Number(current.latitude)); if (currentProjection) showEquipmentPopup(current, currentProjection); };
      el.addEventListener('mouseenter', show); el.addEventListener('focus', show); el.addEventListener('mouseleave', () => equipmentPopup?.remove()); el.addEventListener('blur', () => equipmentPopup?.remove());
      marker = new maplibregl.Marker({ element: el }).setLngLat(projection.coordinate).addTo(map); equipmentMarkers.set(item.equipment_id, marker);
    }
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
  const currentRequester = elements.ldlRequester.value, currentEditRequester = elements.ldlEditRequester.value, currentEquipment = elements.circEquipment.value, currentEditEquipment = elements.circEditEquipment.value, currentPermEquipment = elements.permEquipment.value;
  const currentOperator = elements.circOperator.value, currentEditOperator = elements.circEditOperator.value, currentPermOperator = elements.permOperator.value;
  elements.ldlRequester.replaceChildren();
  for (const item of state.requesters.filter((r) => r.active)) elements.ldlRequester.add(new Option(`${item.code} · ${item.name}`, item.code));
  elements.ldlEditRequester.replaceChildren();
  for (const item of state.requesters.filter((r) => r.active)) elements.ldlEditRequester.add(new Option(`${item.code} · ${item.name}`, item.code));
  elements.circEquipment.replaceChildren();
  elements.circEditEquipment.replaceChildren();
  for (const item of state.equipment) elements.circEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  for (const item of state.equipment) elements.circEditEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  elements.permEquipment.replaceChildren();
  for (const item of state.equipment) elements.permEquipment.add(new Option(`${item.id} · ${item.name}`, item.id));
  elements.circOperator.replaceChildren(new Option('Não informado', ''));
  elements.circEditOperator.replaceChildren(new Option('Não informado', ''));
  elements.permOperator.replaceChildren(new Option('Não informado', ''));
  for (const item of state.operators) elements.circOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  for (const item of state.operators) elements.circEditOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  for (const item of state.operators) elements.permOperator.add(new Option(`${item.name} · ${item.registration}`, item.registration));
  if ([...elements.ldlRequester.options].some((o) => o.value === currentRequester)) elements.ldlRequester.value = currentRequester;
  if ([...elements.ldlEditRequester.options].some((o) => o.value === currentEditRequester)) elements.ldlEditRequester.value = currentEditRequester;
  if ([...elements.circEquipment.options].some((o) => o.value === currentEquipment)) elements.circEquipment.value = currentEquipment;
  if ([...elements.circEditEquipment.options].some((o) => o.value === currentEditEquipment)) elements.circEditEquipment.value = currentEditEquipment;
  if ([...elements.permEquipment.options].some((o) => o.value === currentPermEquipment)) elements.permEquipment.value = currentPermEquipment;
  if ([...elements.circOperator.options].some((o) => o.value === currentOperator)) elements.circOperator.value = currentOperator;
  if ([...elements.circEditOperator.options].some((o) => o.value === currentEditOperator)) elements.circEditOperator.value = currentEditOperator;
  if ([...elements.permOperator.options].some((o) => o.value === currentPermOperator)) elements.permOperator.value = currentPermOperator;
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

const AUDIT_FIELD_LABELS = { requesterCode: 'Responsável', kmStart: 'KM inicial', kmEnd: 'KM final', lines: 'Linhas', workforceCount: 'Quantidade de pessoas', start: 'Início', end: 'Fim previsto', description: 'Serviço', channel: 'Canal', revision: 'Revisão' };
const CIRC_AUDIT_FIELD_LABELS = { equipmentId: 'Equipamento comandante', equipmentMembers: 'Equipamentos acoplados', helperEquipmentId: 'Locomotiva auxiliar (legado)', operatorRegistration: 'Operador', line: 'Linha', kmStart: 'KM inicial', kmEnd: 'KM final', start: 'Início', end: 'Fim previsto', direction: 'Sentido', restrictions: 'Restrições/observações', composition: 'Composição de vagões', wagonType: 'Tipo de vagão', wagonCount: 'Quantidade de vagões', loadStatus: 'Condição da composição', cargoDescription: 'Material transportado', revision: 'Revisão' };
function auditValue(key, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'kmStart' || key === 'kmEnd') return formatKm(value);
  if (key === 'lines') return value.length ? value.map(lineLabel).join(' + ') : '—';
  if (key === 'start' || key === 'end') return date(value);
  if (key === 'channel') return value === 'whatsapp' ? 'WhatsApp' : 'Rádio';
  if (key === 'line') return lineLabel(value);
  if (key === 'operatorRegistration') return value ? (state?.operators.find((item) => item.registration === value)?.name || value) : 'Não informado';
  if (key === 'direction') return value === 'crescente' ? 'KM crescente' : value === 'decrescente' ? 'KM decrescente' : 'Manobra';
  if (key === 'loadStatus') return value === 'loaded' ? 'Carregado' : value === 'empty' ? 'Vazio' : 'Não se aplica';
  if (key === 'helperEquipmentId') return value || 'Sem locomotiva auxiliar';
  if (key === 'composition') return compositionLabel({ composition: Array.isArray(value) ? value : [] });
  if (key === 'equipmentMembers') return Array.isArray(value) && value.length ? value.map((item) => `${item.equipmentId} (${memberRoleLabel(item.operationalRole)})`).join(' + ') : 'Nenhum equipamento acoplado';
  return String(value ?? '—');
}
function hasActiveLinkedPermissive(item, kind) { return activePermissives().some((permission) => permission.links?.some((link) => link.kind === kind && link.id === item.id)); }

function openEditLdl(item) {
  editingLdl = item; notify(elements.ldlEditMessage, ''); elements.ldlEditCode.textContent = displayCode(item, 'LDL');
  elements.ldlEditRequester.value = item.requester_code; elements.ldlEditChannel.value = item.request_channel; elements.ldlEditKmStart.value = formatKm(item.km_start); elements.ldlEditKmEnd.value = formatKm(item.km_end);
  elements.ldlEditWorkforce.value = item.workforce_count; elements.ldlEditStart.value = isoLocal(Date.parse(item.requested_start)); elements.ldlEditEnd.value = isoLocal(Date.parse(item.requested_end)); elements.ldlEditDescription.value = item.work_description; elements.ldlEditReason.value = '';
  updateTrackContext('edit-ldl');
  for (const checkbox of document.querySelectorAll('[name="edit-ldl-line"]')) checkbox.checked = item.lines.includes(checkbox.value);
  ccoMotion.dialog(elements.ldlEditDialog);
}

function showLdlAudit(item) {
  elements.ldlAuditTitle.textContent = `${displayCode(item, 'LDL')} · histórico de revisões`;
  elements.ldlAuditSummary.textContent = `Revisão atual ${Number(item.revision || 0)} · emitida por ${item.controller_name} em ${date(item.created_at)}${item.updated_at ? ` · última alteração por ${item.updated_by_name || item.updated_by_controller} em ${date(item.updated_at)}` : ''}`;
  elements.ldlAuditEvents.replaceChildren();
  const events = (state.ldlEvents || []).filter((event) => event.ldl_id === item.id).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  for (const event of events) {
    const card = document.createElement('article'), head = document.createElement('header'), title = document.createElement('strong'), meta = document.createElement('span');
    title.textContent = event.event_type === 'created' ? 'LDL emitida' : event.event_type === 'updated' ? `Revisão ${event.payload?.after?.revision ?? '—'}` : event.event_type === 'returned' ? 'Linha devolvida' : 'LDL cancelada';
    meta.textContent = `${event.controller_code} · ${event.controller_name} · ${date(event.occurred_at)}`; head.append(title, meta); card.append(head);
    if (event.payload?.reason) { const reason = document.createElement('p'); reason.className = 'audit-reason'; reason.textContent = `Justificativa: ${event.payload.reason}`; card.append(reason); }
    const before = event.payload?.before || {}, after = event.payload?.after || {}, changed = Object.keys(AUDIT_FIELD_LABELS).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]) && key in after);
    if (changed.length) {
      const list = document.createElement('dl');
      for (const key of changed) { const row = document.createElement('div'), term = document.createElement('dt'), oldValue = document.createElement('dd'), arrow = document.createElement('i'), newValue = document.createElement('dd'); term.textContent = AUDIT_FIELD_LABELS[key]; oldValue.textContent = auditValue(key, before[key]); arrow.textContent = '→'; newValue.textContent = auditValue(key, after[key]); row.append(term, oldValue, arrow, newValue); list.append(row); }
      card.append(list);
    } else { const note = document.createElement('p'); note.textContent = event.payload?.note || (event.event_type === 'created' ? 'Registro original preservado.' : 'Evento operacional registrado.'); card.append(note); }
    elements.ldlAuditEvents.append(card);
  }
  if (!events.length) elements.ldlAuditEvents.innerHTML = '<div class="empty">Nenhum evento encontrado para esta LDL.</div>';
  ccoMotion.dialog(elements.ldlAuditDialog);
}

function openEditCirculation(item) {
  editingCirculation = item; notify(elements.circEditMessage, ''); elements.circEditCode.textContent = displayCode(item, 'CIRC');
  elements.circEditEquipment.value = item.equipment_id; elements.circEditOperator.value = item.operator_registration || ''; elements.circEditLine.value = item.line_id; elements.circEditDirection.value = item.direction;
  renderEquipmentFormationEditor(elements.circEditEquipmentList, item.equipmentMembers || []);
  const isDecreasing = item.direction === 'decrescente'; elements.circEditKmStart.value = formatKm(isDecreasing ? item.km_end : item.km_start); elements.circEditKmEnd.value = formatKm(isDecreasing ? item.km_start : item.km_end); elements.circEditStart.value = isoLocal(Date.parse(item.planned_start)); elements.circEditEnd.value = isoLocal(Date.parse(item.planned_end)); renderCompositionEditor(elements.circEditCompositionList, item.composition || []); elements.circEditRestrictions.value = item.restrictions || ''; elements.circEditReason.value = '';
  updateTrackContext('edit-circulation'); elements.circEditLine.value = item.line_id; ccoMotion.dialog(elements.circEditDialog);
}

function showCirculationAudit(item) {
  elements.circAuditTitle.textContent = `${displayCode(item, 'CIRC')} · histórico de revisões`;
  elements.circAuditSummary.textContent = `Revisão atual ${Number(item.revision || 0)} · autorizada por ${item.controller_name} em ${date(item.authorized_at)}${item.updated_at ? ` · última alteração por ${item.updated_by_name || item.updated_by_controller} em ${date(item.updated_at)}` : ''}`;
  elements.circAuditEvents.replaceChildren();
  const events = (state.circulationEvents || []).filter((event) => event.circulation_id === item.id).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  for (const event of events) {
    const card = document.createElement('article'), head = document.createElement('header'), title = document.createElement('strong'), meta = document.createElement('span');
    title.textContent = event.event_type === 'authorized' ? 'Circulação autorizada' : event.event_type === 'updated' ? `Revisão ${event.payload?.after?.revision ?? '—'}` : event.event_type === 'completed' ? 'Circulação concluída' : 'Circulação cancelada';
    meta.textContent = `${event.controller_code} · ${event.controller_name} · ${date(event.occurred_at)}`; head.append(title, meta); card.append(head);
    if (event.payload?.reason) { const reason = document.createElement('p'); reason.className = 'audit-reason'; reason.textContent = `Justificativa: ${event.payload.reason}`; card.append(reason); }
    const before = event.payload?.before || {}, after = event.payload?.after || {}, changed = Object.keys(CIRC_AUDIT_FIELD_LABELS).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]) && key in after);
    if (changed.length) {
      const list = document.createElement('dl');
      for (const key of changed) { const row = document.createElement('div'), term = document.createElement('dt'), oldValue = document.createElement('dd'), arrow = document.createElement('i'), newValue = document.createElement('dd'); term.textContent = CIRC_AUDIT_FIELD_LABELS[key]; oldValue.textContent = auditValue(key, before[key]); arrow.textContent = '→'; newValue.textContent = auditValue(key, after[key]); row.append(term, oldValue, arrow, newValue); list.append(row); }
      card.append(list);
    } else { const note = document.createElement('p'); note.textContent = event.payload?.note || (event.event_type === 'authorized' ? 'Registro original preservado.' : 'Evento operacional registrado.'); card.append(note); }
    elements.circAuditEvents.append(card);
  }
  if (!events.length) elements.circAuditEvents.innerHTML = '<div class="empty">Nenhum evento encontrado para esta circulação.</div>';
  ccoMotion.dialog(elements.circAuditDialog);
}

function record(item, kind) {
  const isLdl = kind === 'ldl', isPermissive = kind === 'permissive', isCirculation = kind === 'circulation', wrapper = document.createElement('article'); wrapper.className = `record ${isLdl ? '' : isPermissive ? 'permissive' : 'circulation'}`;
  const prefix = isLdl ? 'LDL' : isPermissive ? 'PERM' : 'CIRC';
  const codeText = displayCode(item, prefix), main = isLdl ? `${item.requester_code} · ${item.requester_name} · ${item.workforce_count} pessoas` : isCirculation ? `${tractionLabel(item)} · ${item.operator_name || 'operador não informado'}` : `${item.equipment_id} · ${item.operator_name || 'operador não informado'}`;
  const lines = isLdl ? item.lines.map(lineLabel).join(' + ') : lineLabel(item.line_id);
  wrapper.innerHTML = `<div class="code"></div><div><strong></strong><span></span><small></small></div><div class="record-actions"><button class="secondary" data-edit>EDITAR</button><button class="secondary" data-audit>AUDITORIA</button><button data-complete></button><button class="danger" data-cancel>CANCELAR</button></div>`;
  wrapper.querySelector('.code').textContent = codeText; wrapper.querySelector('strong').textContent = main; wrapper.querySelector('span').textContent = `${lines} · KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}${isPermissive ? ' · MÁX. 15 KM/H' : ''}`; wrapper.querySelector('small').textContent = `${date(isLdl ? item.requested_start : item.planned_start)} → ${date(isLdl ? item.requested_end : item.planned_end)}`;
  if (isPermissive) {
    const linkedLabels = (item.links || []).map((link) => { const source = link.kind === 'LDL' ? state.ldls.find((entry) => entry.id === link.id) : state.circulations.find((entry) => entry.id === link.id); return source ? displayCode(source, link.kind) : `${link.kind} vinculada`; });
    const details = document.createElement('details'); details.className = 'permission-details'; details.innerHTML = '<summary>VER CONDIÇÕES</summary><p></p>';
    details.querySelector('p').textContent = `Vinculado a ${linkedLabels.join(' + ')} · ${item.communication_channel === 'whatsapp' ? 'WhatsApp' : 'Rádio'} confirmado · Serviço: ${item.work_description} · Justificativa: ${item.justification}`;
    wrapper.children[1].append(details);
  }
  if (isLdl) {
    const revision = document.createElement('small'); revision.className = 'revision-meta'; revision.textContent = `Revisão ${Number(item.revision || 0)}${item.updated_at ? ` · alterada em ${date(item.updated_at)} por ${item.updated_by_name || item.updated_by_controller}` : ' · registro original'}`; wrapper.children[1].append(revision);
    const edit = wrapper.querySelector('[data-edit]'); edit.onclick = () => openEditLdl(item); edit.disabled = hasActiveLinkedPermissive(item, 'LDL'); if (edit.disabled) edit.title = 'Encerre primeiro o permissivo vinculado.';
    wrapper.querySelector('[data-audit]').onclick = () => showLdlAudit(item);
  } else if (isCirculation) {
    const consist = document.createElement('small'); consist.className = 'circulation-consist'; consist.textContent = compositionLabel(item); wrapper.children[1].append(consist);
    const revision = document.createElement('small'); revision.className = 'revision-meta'; revision.textContent = `Revisão ${Number(item.revision || 0)}${item.updated_at ? ` · alterada em ${date(item.updated_at)} por ${item.updated_by_name || item.updated_by_controller}` : ' · registro original'}`; wrapper.children[1].append(revision);
    const edit = wrapper.querySelector('[data-edit]'); edit.onclick = () => openEditCirculation(item); edit.disabled = hasActiveLinkedPermissive(item, 'CIRC'); if (edit.disabled) edit.title = 'Encerre primeiro o permissivo vinculado.';
    wrapper.querySelector('[data-audit]').onclick = () => showCirculationAudit(item);
  } else { wrapper.querySelector('[data-edit]').remove(); wrapper.querySelector('[data-audit]').remove(); }
  wrapper.querySelector('[data-complete]').textContent = isLdl ? 'REGISTRAR DEVOLUÇÃO' : isPermissive ? 'ENCERRAR PERMISSIVO' : 'CONCLUIR';
  wrapper.querySelector('[data-complete]').onclick = () => closeRecord(item.id, kind, isLdl ? 'return' : 'complete');
  wrapper.querySelector('[data-cancel]').onclick = () => closeRecord(item.id, kind, 'cancel');
  const mapHint = document.createElement('small'); mapHint.className = 'map-link-hint'; mapHint.textContent = '↗ CLIQUE PARA LOCALIZAR NO MAPA'; wrapper.children[1].append(mapHint);
  wrapper.classList.add('map-link'); wrapper.tabIndex = 0; wrapper.title = `${codeText}: localizar trecho no mapa`;
  const focusRecord = (event) => {
    if (event.target.closest('button, a, input, select, textarea, summary, details')) return;
    focusMapOperation(item, kind);
  };
  wrapper.addEventListener('click', focusRecord);
  wrapper.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, a, input, select, textarea, summary, details')) { event.preventDefault(); focusMapOperation(item, kind); }
  });
  return wrapper;
}

function renderHistory() {
  const filter = elements.historyFilter.value, rows = [];
  if (filter === 'all' || filter === 'ldl') for (const item of state.ldls) rows.push({ code: displayCode(item, 'LDL'), status: item.status, owner: `${item.requester_code} · ${item.requester_name} · ${item.workforce_count} pessoas`, line: item.lines.map(lineLabel).join(' + '), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.requested_start, end: item.requested_end, controller: `${item.created_by_controller} · ${item.controller_name}`, time: item.created_at });
  if (filter === 'all' || filter === 'circulation') for (const item of state.circulations) rows.push({ code: displayCode(item, 'CIRC'), status: item.status, owner: `${tractionLabel(item)} · ${compositionLabel(item)} · ${item.operator_name || '—'}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.planned_start, end: item.planned_end, controller: `${item.authorized_by_controller} · ${item.controller_name}`, time: item.authorized_at });
  if (filter === 'all' || filter === 'permissive') for (const item of state.permissives) rows.push({ code: displayCode(item, 'PERM'), status: item.status, owner: `${item.equipment_id} · 15 km/h · ${item.operator_name || '—'}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, start: item.planned_start, end: item.planned_end, controller: `${item.authorized_by_controller} · ${item.controller_name}`, time: item.authorized_at });
  rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)); elements.historyBody.replaceChildren();
  for (const item of rows) { const row = elements.historyBody.insertRow(); [item.code, STATUS_LABELS[item.status] || item.status, item.owner, item.line, item.km, date(item.start), date(item.end), item.controller].forEach((value) => { const cell = row.insertCell(); cell.textContent = value; }); }
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
  elements.freshness.textContent = `Atualizado em ${date(state.serverTime)} · ciclo automático/5 s`; populateSelects(); renderHistory(); renderSafetyEvents(); renderMap(); ccoMotion.kpis(); ccoMotion.records();
}

async function load() {
  if (loading) return false; loading = true;
  try { state = await api('/api/v1/cco/state'); await syncSafetyEvents(); elements.controller.textContent = `${state.controller.code} · ${state.controller.name}`; render(); refreshFailures = 0; return true; }
  catch (error) { if (error.status === 401) { showLogin(); return false; } refreshFailures += 1; notify(elements.message, error.message); return false; }
  finally { loading = false; }
}
function nextRefreshDelay() { return Math.min(60_000, 5_000 * 2 ** refreshFailures); }
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!sessionToken || document.hidden) return;
  refreshTimer = setTimeout(async () => { await load(); scheduleRefresh(); }, nextRefreshDelay());
}
function showLogin() { clearTimeout(refreshTimer); sessionToken = ''; sessionStorage.removeItem('ficoCcoToken'); elements.login.hidden = false; elements.app.hidden = true; elements.logout.hidden = true; elements.controller.textContent = 'AGUARDANDO ACESSO'; }
function showApp() { elements.login.hidden = true; elements.app.hidden = false; elements.logout.hidden = false; setTimeout(() => { map?.resize(); ccoMotion.revealApp(); }, 0); }

async function closeRecord(id, kind, action) {
  const isCancel = action === 'cancel', note = isCancel ? prompt('Informe a justificativa obrigatória do cancelamento:') : prompt(kind === 'ldl' ? 'Observação da devolução (opcional):' : kind === 'permissive' ? 'Observação do encerramento permissivo (opcional):' : 'Observação da conclusão (opcional):', '');
  if (note === null || (isCancel && note.trim().length < 3)) return;
  if (!confirm(`${action === 'return' ? 'Registrar devolução' : action === 'complete' ? 'Concluir circulação' : 'Cancelar registro'}?`)) return;
  try { await api(`/api/v1/cco/${kind === 'ldl' ? 'ldl' : kind === 'permissive' ? 'permissive' : 'circulation'}/close`, { method: 'POST', body: JSON.stringify({ id, action, note }) }); await load(); }
  catch (error) { notify(elements.message, error.message); }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.loginMessage, '');
  try { const data = await api('/api/v1/cco/login', { method: 'POST', body: JSON.stringify({ code: elements.code.value, pin: elements.pin.value }) }); sessionToken = data.token; sessionStorage.setItem('ficoCcoToken', sessionToken); elements.pin.value = ''; showApp(); await load(); scheduleRefresh(); }
  catch (error) { notify(elements.loginMessage, error.message); }
});
elements.logout.onclick = async () => { try { await api('/api/v1/cco/logout', { method: 'POST' }); } catch {} showLogin(); };
elements.refresh.onclick = load; elements.historyFilter.onchange = renderHistory; elements.pdf.onclick = () => window.print();
elements.excel.onclick = () => {
  if (!state) return; const rows = [['Código','Tipo','Situação','Responsável/Equipamento','Linha','KM inicial','KM final','Início','Fim','Controlador']];
  for (const item of state.ldls) rows.push([item.permanent_code,'LDL',item.status,`${item.requester_code} - ${item.requester_name}`,item.lines.map(lineLabel).join(' + '),formatKm(item.km_start),formatKm(item.km_end),item.requested_start,item.requested_end,`${item.created_by_controller} - ${item.controller_name}`]);
  for (const item of state.circulations) rows.push([item.permanent_code,'Circulação',item.status,`${tractionLabel(item)} · ${compositionLabel(item)}`,lineLabel(item.line_id),formatKm(item.km_start),formatKm(item.km_end),item.planned_start,item.planned_end,`${item.authorized_by_controller} - ${item.controller_name}`]);
  for (const item of state.permissives) rows.push([item.permanent_code,'Permissivo 15 km/h',item.status,item.equipment_id,lineLabel(item.line_id),formatKm(item.km_start),formatKm(item.km_end),item.planned_start,item.planned_end,`${item.authorized_by_controller} - ${item.controller_name}`]);
  for (const item of state.safetyEvents || []) rows.push([item.id,'Invasão de LDL',item.status,item.equipment_id,'Linha 01',formatKm(item.station_m),formatKm(item.station_m),item.first_seen_at,item.last_seen_at,item.detected_by_controller]);
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';')).join('\r\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `controle-cco-${new Date().toISOString().slice(0,7)}.csv`; link.click(); URL.revokeObjectURL(url);
};
elements.ldlAuditExport.onclick = () => {
  if (!state) return; const rows = [['LDL','Evento','Revisão','Data/hora','Controlador','Justificativa','Campo alterado','Valor anterior','Novo valor']];
  for (const event of state.ldlEvents || []) {
    const before = event.payload?.before || {}, after = event.payload?.after || {}, changed = Object.keys(AUDIT_FIELD_LABELS).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]) && key in after);
    if (changed.length) for (const key of changed) rows.push([event.permanent_code,event.event_type,after.revision ?? before.revision ?? '',event.occurred_at,`${event.controller_code} - ${event.controller_name}`,event.payload?.reason || '',AUDIT_FIELD_LABELS[key],auditValue(key,before[key]),auditValue(key,after[key])]);
    else rows.push([event.permanent_code,event.event_type,after.revision ?? before.revision ?? '',event.occurred_at,`${event.controller_code} - ${event.controller_name}`,event.payload?.reason || event.payload?.note || '','Evento operacional','','']);
  }
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';')).join('\r\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `auditoria-ldl-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
};
elements.circAuditExport.onclick = () => {
  if (!state) return; const rows = [['Circulação','Evento','Revisão','Data/hora','Controlador','Justificativa','Campo alterado','Valor anterior','Novo valor']];
  for (const event of state.circulationEvents || []) {
    const before = event.payload?.before || {}, after = event.payload?.after || {}, changed = Object.keys(CIRC_AUDIT_FIELD_LABELS).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]) && key in after);
    if (changed.length) for (const key of changed) rows.push([event.permanent_code,event.event_type,after.revision ?? before.revision ?? '',event.occurred_at,`${event.controller_code} - ${event.controller_name}`,event.payload?.reason || '',CIRC_AUDIT_FIELD_LABELS[key],auditValue(key,before[key]),auditValue(key,after[key])]);
    else rows.push([event.permanent_code,event.event_type,after.revision ?? before.revision ?? '',event.occurred_at,`${event.controller_code} - ${event.controller_name}`,event.payload?.reason || event.payload?.note || '','Evento operacional','','']);
  }
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(';')).join('\r\n'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `auditoria-circulacoes-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
};

document.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => { const dialog = $(button.dataset.open), now = Date.now(); if (dialog.id === 'ldl-dialog') { elements.ldlStart.value = isoLocal(now); elements.ldlEnd.value = isoLocal(now + 4 * 3600000); updateTrackContext('ldl'); } else if (dialog.id === 'circulation-dialog') { elements.circStart.value = isoLocal(now); elements.circEnd.value = isoLocal(now + 2 * 3600000); updateTrackContext('circulation'); updateCompositionEditor(elements.circCompositionList); } else { elements.permStart.value = isoLocal(now); elements.permEnd.value = isoLocal(now + 2 * 3600000); updateTrackContext('permissive'); renderPermissiveConflicts(); } ccoMotion.dialog(dialog); });
document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => button.closest('dialog').close());
elements.circAddEquipment.onclick = () => addEquipmentMemberRow(elements.circEquipmentList);
elements.circEditAddEquipment.onclick = () => addEquipmentMemberRow(elements.circEditEquipmentList);
elements.circAddConsist.onclick = () => addCompositionRow(elements.circCompositionList);
elements.circEditAddConsist.onclick = () => addCompositionRow(elements.circEditCompositionList);
renderEquipmentFormationEditor(elements.circEquipmentList);
renderEquipmentFormationEditor(elements.circEditEquipmentList);
renderCompositionEditor(elements.circCompositionList);
renderCompositionEditor(elements.circEditCompositionList);
document.querySelectorAll('[data-basemap]').forEach((button) => button.onclick = () => setBasemap(button.dataset.basemap));
document.querySelectorAll('[data-package]').forEach((button) => button.onclick = () => focusPackage(button.dataset.package));
for (const input of [elements.ldlKmStart, elements.ldlKmEnd]) input.addEventListener('input', () => updateTrackContext('ldl'));
for (const input of [elements.ldlEditKmStart, elements.ldlEditKmEnd]) input.addEventListener('input', () => updateTrackContext('edit-ldl'));
for (const input of [elements.circKmStart, elements.circKmEnd]) input.addEventListener('input', () => updateTrackContext('circulation'));
for (const input of [elements.circEditKmStart, elements.circEditKmEnd]) input.addEventListener('input', () => updateTrackContext('edit-circulation'));
elements.circLine.addEventListener('change', () => updateTrackContext('circulation'));
elements.circEditLine.addEventListener('change', () => updateTrackContext('edit-circulation'));
for (const input of [elements.permKmStart, elements.permKmEnd]) input.addEventListener('input', () => updateTrackContext('permissive'));
elements.ldlForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.ldlMessage, ''); const lines = [...document.querySelectorAll('[name="ldl-line"]:checked')].map((item) => item.value);
  try { const data = await api('/api/v1/cco/ldl/create', { method: 'POST', body: JSON.stringify({ requesterCode: elements.ldlRequester.value, channel: elements.ldlChannel.value, kmStart: parseKm(elements.ldlKmStart.value), kmEnd: parseKm(elements.ldlKmEnd.value), lines, workforceCount: elements.ldlWorkforce.value, start: ccoLocalToIso(elements.ldlStart.value), end: ccoLocalToIso(elements.ldlEnd.value), description: elements.ldlDescription.value }) }); elements.ldlForm.closest('dialog').close(); notify(elements.message, `${data.ldl.displayCode} emitida com sucesso.`, true); elements.ldlForm.reset(); await load(); }
  catch (error) { notify(elements.ldlMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});
elements.ldlEditForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.ldlEditMessage, ''); if (!editingLdl) return;
  const lines = [...document.querySelectorAll('[name="edit-ldl-line"]:checked')].map((item) => item.value);
  try {
    const data = await api('/api/v1/cco/ldl/update', { method: 'POST', body: JSON.stringify({ id: editingLdl.id, expectedRevision: Number(editingLdl.revision || 0), requesterCode: elements.ldlEditRequester.value, channel: elements.ldlEditChannel.value, kmStart: parseKm(elements.ldlEditKmStart.value), kmEnd: parseKm(elements.ldlEditKmEnd.value), lines, workforceCount: elements.ldlEditWorkforce.value, start: ccoLocalToIso(elements.ldlEditStart.value), end: ccoLocalToIso(elements.ldlEditEnd.value), description: elements.ldlEditDescription.value, reason: elements.ldlEditReason.value }) });
    elements.ldlEditDialog.close(); editingLdl = null; notify(elements.message, `${data.ldl.displayCode} atualizada para a revisão ${data.ldl.revision}. Auditoria registrada.`, true); await load();
  } catch (error) { notify(elements.ldlEditMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});
elements.circulationForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.circMessage, '');
  try { const data = await api('/api/v1/cco/circulation/create', { method: 'POST', body: JSON.stringify({ equipmentId: elements.circEquipment.value, equipmentMembers: readEquipmentMembers(elements.circEquipmentList), operatorRegistration: elements.circOperator.value, line: elements.circLine.value, direction: elements.circDirection.value, kmStart: parseKm(elements.circKmStart.value), kmEnd: parseKm(elements.circKmEnd.value), start: ccoLocalToIso(elements.circStart.value), end: ccoLocalToIso(elements.circEnd.value), composition: readComposition(elements.circCompositionList), restrictions: elements.circRestrictions.value }) }); elements.circulationForm.closest('dialog').close(); notify(elements.message, `${data.circulation.displayCode} autorizada com sucesso.`, true); elements.circulationForm.reset(); renderEquipmentFormationEditor(elements.circEquipmentList); renderCompositionEditor(elements.circCompositionList); await load(); }
  catch (error) { notify(elements.circMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});
elements.circEditForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.circEditMessage, ''); if (!editingCirculation) return;
  try {
    const data = await api('/api/v1/cco/circulation/update', { method: 'POST', body: JSON.stringify({ id: editingCirculation.id, expectedRevision: Number(editingCirculation.revision || 0), equipmentId: elements.circEditEquipment.value, equipmentMembers: readEquipmentMembers(elements.circEditEquipmentList), operatorRegistration: elements.circEditOperator.value, line: elements.circEditLine.value, direction: elements.circEditDirection.value, kmStart: parseKm(elements.circEditKmStart.value), kmEnd: parseKm(elements.circEditKmEnd.value), start: ccoLocalToIso(elements.circEditStart.value), end: ccoLocalToIso(elements.circEditEnd.value), composition: readComposition(elements.circEditCompositionList), restrictions: elements.circEditRestrictions.value, reason: elements.circEditReason.value }) });
    elements.circEditDialog.close(); editingCirculation = null; notify(elements.message, `${data.circulation.displayCode} atualizada para a revisão ${data.circulation.revision}. Auditoria registrada.`, true); await load();
  } catch (error) { notify(elements.circEditMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); }
});

for (const element of [elements.permLine, elements.permKmStart, elements.permKmEnd, elements.permStart, elements.permEnd]) element.addEventListener('input', renderPermissiveConflicts);
elements.permissiveForm.addEventListener('submit', async (event) => {
  event.preventDefault(); notify(elements.permMessage, '');
  const linkedRecords = [...document.querySelectorAll('[name="perm-record"]:checked')].map((item) => ({ kind: item.dataset.kind, id: item.value }));
  try {
    const data = await api('/api/v1/cco/permissive/create', { method: 'POST', body: JSON.stringify({ equipmentId: elements.permEquipment.value, operatorRegistration: elements.permOperator.value, line: elements.permLine.value, kmStart: parseKm(elements.permKmStart.value), kmEnd: parseKm(elements.permKmEnd.value), start: ccoLocalToIso(elements.permStart.value), end: ccoLocalToIso(elements.permEnd.value), channel: elements.permChannel.value, description: elements.permDescription.value, justification: elements.permJustification.value, communicationConfirmed: elements.permConfirmed.checked, linkedRecords }) });
    elements.permissiveForm.closest('dialog').close(); notify(elements.message, `${data.permissive.displayCode} emitido com limite obrigatório de 15 km/h.`, true); elements.permissiveForm.reset(); await load();
  } catch (error) { notify(elements.permMessage, `${error.message}${error.conflicts?.length ? ` Conflito: ${error.conflicts.map((x) => x.code).join(', ')}.` : ''}`); renderPermissiveConflicts(); }
});

setInterval(() => $('clock').textContent = new Date().toLocaleTimeString('pt-BR'), 1000);
fetch(AXIS_URL).then((response) => response.json()).then((data) => { axis = data.points; initMap(); if (sessionToken) { showApp(); load(); } }).catch((error) => notify(elements.loginMessage, `Traçado indisponível: ${error.message}`));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(refreshTimer);
  else if (sessionToken) { load().finally(scheduleRefresh); }
});
if (sessionToken) scheduleRefresh();
