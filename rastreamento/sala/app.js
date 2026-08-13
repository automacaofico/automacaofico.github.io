import { createSafetyAudio } from '../safety-audio.js?v=20260811-5';
import { addInfrastructureLayers } from '../rail-infrastructure-map.js?v=20260811-2';
import { lineCoordinates, LINE_LABELS } from '../rail-infrastructure.js?v=20260811-2';

const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../../mapa-superestrutura/assets/data/fico-axis-full.json';
const PACKAGES = [
  { id: 'P01', start: 0, end: 38100, color: '#1e86ba' }, { id: 'P02', start: 38100, end: 71300, color: '#55a646' },
  { id: 'P03', start: 71300, end: 104500, color: '#ee7623' }, { id: 'P04', start: 104500, end: 131260, color: '#8c6fba' },
  { id: 'P05', start: 131260, end: 167300, color: '#19a6a6' }, { id: 'P06', start: 167300, end: 225000, color: '#c95b69' },
  { id: 'P07', start: 225000, end: 239950, color: '#778997' }, { id: 'P08', start: 239950, end: 292260, color: '#bd8121' }
];
const $ = (id) => document.getElementById(id);
const els = {
  connection: $('connection'), updated: $('updated'), clock: $('clock'), today: $('today'), ldl: $('ldl'), people: $('people'),
  circulations: $('circulations'), permissives: $('permissives'), online: $('online'), alertTotal: $('alert-total'),
  operationTotal: $('operation-total'), operations: $('operations'), asideAlertCount: $('aside-alert-count'), alertList: $('alert-list'),
  fleet: $('fleet'), fit: $('fit'), fullscreen: $('fullscreen'), sound: $('sound'), criticalBanner: $('critical-banner'), criticalText: $('critical-text')
};
let axis = [], grid = new Map(), map, equipment = [], operations = { ldls: [], circulations: [], permissives: [], safetyEvents: [] };
let markers = new Map(), kmPopup, operationPopup, equipmentPopup, hoveredEquipmentId = null, lastSuccess = 0;
let lastCriticalSignature = '', lastCriticalSoundAt = 0, lastWarningSignature = '';
const safetyAudio = createSafetyAudio(els.sound, 'ficoTvSafetySound');

const formatKm = (meters) => { const value = Math.max(0, Math.round(Number(meters) || 0)); return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, '0')}`; };
const formatTime = (value) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const lineLabel = (line) => LINE_LABELS[line] || line;
const age = (value) => { const seconds = Math.max(0, (Date.now() - Date.parse(value)) / 1000); return seconds < 60 ? `${Math.round(seconds)} s` : seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds / 3600)} h`; };
const equipmentStatus = (item) => !item.receivedAt ? 'no-signal' : Date.now() - Date.parse(item.receivedAt) <= 30000 ? 'online' : Date.now() - Date.parse(item.receivedAt) <= 120000 ? 'unstable' : 'offline';
const displayCode = (item, prefix) => `${prefix} ${String(item.sequence_number || '').padStart(3, '0')}`;
const tractionLabel = (item) => `${item.equipment_id}${item.helper_equipment_id ? ` + ${item.helper_equipment_id}` : ''}`;
const compositionLabel = (item) => !item.wagon_type || !Number(item.wagon_count) ? 'escoteira' : `${item.wagon_count} ${item.wagon_type} · ${item.load_status === 'loaded' ? `carregados${item.cargo_description ? ` · ${item.cargo_description}` : ''}` : 'vazios'}`;
const gridKey = (lon, lat) => `${Math.floor(lon / .02)}:${Math.floor(lat / .02)}`;

function prepareAxis(points) {
  axis = points; grid = new Map();
  for (const point of points) { const key = gridKey(point.coordinate[0], point.coordinate[1]); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(point); }
}
function distance(lonA, latA, lonB, latB) { const y = (latB - latA) * 111320, x = (lonB - lonA) * 111320 * Math.cos((latA + latB) * Math.PI / 360); return Math.hypot(x, y); }
function projectToAxis(lon, lat) {
  lon = Number(lon); lat = Number(lat); const gx = Math.floor(lon / .02), gy = Math.floor(lat / .02); let best;
  for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const point of grid.get(`${x}:${y}`) || []) {
    const distanceM = distance(lon, lat, point.coordinate[0], point.coordinate[1]);
    if (!best || distanceM < best.distanceM) best = { stationM: point.station_m, distanceM, coordinate: point.coordinate };
  }
  return best;
}
function pointAtStation(target) {
  target = Math.max(axis[0].station_m, Math.min(Number(target), axis.at(-1).station_m));
  let low = 0, high = axis.length - 1;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (axis[middle].station_m <= target) low = middle; else high = middle; }
  const a = axis[low], b = axis[high], ratio = (target - a.station_m) / Math.max(1, b.station_m - a.station_m);
  return [a.coordinate[0] + ratio * (b.coordinate[0] - a.coordinate[0]), a.coordinate[1] + ratio * (b.coordinate[1] - a.coordinate[1])];
}
function sliceAxis(start, end) { return [pointAtStation(start), ...axis.filter((point) => point.station_m > start && point.station_m < end).map((point) => point.coordinate), pointAtStation(end)]; }
function mapStyle() { return { version: 8, sources: {
  osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
  satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Esri World Imagery' }
}, layers: [{ id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } }, { id: 'satellite', type: 'raster', source: 'satellite' }] }; }

function operationPopupContent(features) {
  const content = document.createElement('section'); content.className = 'map-context-card';
  const heading = document.createElement('div'); heading.className = 'map-context-heading';
  const eyebrow = document.createElement('span'); eyebrow.textContent = features.length > 1 ? 'REGISTROS SOBREPOSTOS' : 'CONTROLE OPERACIONAL';
  const title = document.createElement('strong'); title.textContent = features.length > 1 ? `${features.length} REGISTROS NESTE TRECHO` : features[0].properties.category;
  heading.append(eyebrow, title); content.append(heading);
  for (const feature of features) {
    const item = feature.properties, record = document.createElement('article'); record.className = `map-context-record ${item.kind}`;
    const code = document.createElement('b'); code.textContent = item.code;
    const category = document.createElement('span'); category.textContent = item.category;
    const headline = document.createElement('strong'); headline.textContent = item.headline;
    const route = document.createElement('p'); route.textContent = `${item.line} · KM ${item.km}`;
    const timing = document.createElement('small'); timing.textContent = item.timing;
    record.append(code, category, headline, route, timing);
    if (item.detail) { const detail = document.createElement('em'); detail.textContent = item.detail; record.append(detail); }
    content.append(record);
  }
  return content;
}

function showOperationalPopup(features, lngLat) {
  const unique = features.filter((feature, index, list) => list.findIndex((item) => item.properties.code === feature.properties.code) === index);
  if (!unique.length || hoveredEquipmentId) return;
  if (!operationPopup) operationPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'operation-map-popup', maxWidth: '360px' });
  operationPopup.setLngLat(lngLat).setDOMContent(operationPopupContent(unique)).addTo(map);
}

function equipmentPopupContent(item, projection) {
  const content = document.createElement('section'); content.className = 'map-context-card equipment-context-card';
  const heading = document.createElement('div'); heading.className = 'map-context-heading';
  const eyebrow = document.createElement('span'); eyebrow.textContent = 'EQUIPAMENTO MONITORADO';
  const title = document.createElement('strong'); title.textContent = item.equipmentId;
  heading.append(eyebrow, title);
  const status = equipmentStatus(item), statusLine = document.createElement('div'); statusLine.className = `equipment-context-status ${status}`;
  statusLine.textContent = status === 'online' ? 'ONLINE' : status === 'unstable' ? 'SINAL INSTÁVEL' : 'ÚLTIMA POSIÇÃO';
  const km = document.createElement('b'); km.className = 'equipment-context-km'; km.textContent = `KM ${formatKm(projection.stationM)}`;
  const name = document.createElement('strong'); name.className = 'equipment-context-name'; name.textContent = item.name || item.type || item.equipmentId;
  const telemetry = document.createElement('p'); telemetry.textContent = `${(Number(item.speedMps || 0) * 3.6).toFixed(1).replace('.', ',')} km/h · ${Math.round(projection.distanceM)} m do eixo`;
  const operator = document.createElement('small'); operator.textContent = item.operatorName ? `Operador: ${item.operatorName} · ${item.operatorRegistration}` : 'Operador não identificado';
  const signal = document.createElement('small'); signal.textContent = `Último sinal há ${age(item.receivedAt)}`;
  content.append(heading, statusLine, km, name);
  if (item.description) { const description = document.createElement('em'); description.textContent = item.description; content.append(description); }
  content.append(telemetry, operator, signal);
  return content;
}

function showEquipmentPopup(item) {
  if (!item?.receivedAt || !map) return;
  const projection = projectToAxis(item.longitude, item.latitude); if (!projection) return;
  operationPopup?.remove(); kmPopup?.remove();
  if (!equipmentPopup) equipmentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 24, className: 'equipment-map-popup', maxWidth: '330px' });
  equipmentPopup.setLngLat(projection.coordinate).setDOMContent(equipmentPopupContent(item, projection)).addTo(map);
}

function initMap() {
  map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.3, attributionControl: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.on('load', () => {
    const packages = PACKAGES.map((item) => ({ type: 'Feature', properties: item, geometry: { type: 'LineString', coordinates: sliceAxis(item.start, item.end) } }));
    map.addSource('packages', { type: 'geojson', data: { type: 'FeatureCollection', features: packages } });
    map.addLayer({ id: 'package-case', type: 'line', source: 'packages', paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': .9 } });
    map.addLayer({ id: 'packages', type: 'line', source: 'packages', paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
    map.addLayer({ id: 'rail-hit', type: 'line', source: 'packages', paint: { 'line-color': '#fff', 'line-width': 26, 'line-opacity': .01 } });
    addInfrastructureLayers(map, { sliceAxis, pointAtStation });
    for (const item of PACKAGES) { const element = document.createElement('div'); element.className = 'package-label'; element.style.setProperty('--package', item.color); element.textContent = item.id; new maplibregl.Marker({ element }).setLngLat(pointAtStation((item.start + item.end) / 2)).addTo(map); }
    for (const source of ['ldl', 'circulation', 'permissive']) map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'ldl-case', type: 'line', source: 'ldl', paint: { 'line-color': '#3c0a0a', 'line-width': 14, 'line-opacity': .9 } });
    map.addLayer({ id: 'ldl', type: 'line', source: 'ldl', paint: { 'line-color': '#e14e46', 'line-width': 9 } });
    map.addLayer({ id: 'circulation-case', type: 'line', source: 'circulation', paint: { 'line-color': '#031827', 'line-width': 12, 'line-opacity': .85 } });
    map.addLayer({ id: 'circulation', type: 'line', source: 'circulation', paint: { 'line-color': '#2a8bc8', 'line-width': 7 } });
    map.addLayer({ id: 'permissive-case', type: 'line', source: 'permissive', paint: { 'line-color': '#031827', 'line-width': 13, 'line-opacity': .9 } });
    map.addLayer({ id: 'permissive', type: 'line', source: 'permissive', paint: { 'line-color': '#f1c433', 'line-width': 8, 'line-dasharray': [1.2, .8] } });
    map.addLayer({ id: 'ldl-hit', type: 'line', source: 'ldl', paint: { 'line-color': '#fff', 'line-width': 24, 'line-opacity': .01 } });
    map.addLayer({ id: 'circulation-hit', type: 'line', source: 'circulation', paint: { 'line-color': '#fff', 'line-width': 24, 'line-opacity': .01 } });
    map.addLayer({ id: 'permissive-hit', type: 'line', source: 'permissive', paint: { 'line-color': '#fff', 'line-width': 24, 'line-opacity': .01 } });
    map.on('mousemove', (event) => {
      if (hoveredEquipmentId) return;
      const operational = map.queryRenderedFeatures(event.point, { layers: ['permissive-hit', 'ldl-hit', 'circulation-hit'] });
      if (operational.length) {
        map.getCanvas().style.cursor = 'pointer'; kmPopup?.remove(); showOperationalPopup(operational, event.lngLat); return;
      }
      operationPopup?.remove(); map.getCanvas().style.cursor = '';
      if (!map.queryRenderedFeatures(event.point, { layers: ['rail-hit'] }).length) { kmPopup?.remove(); return; }
      const projection = projectToAxis(event.lngLat.lng, event.lngLat.lat); if (!projection) return;
      const pack = PACKAGES.find((item) => projection.stationM >= item.start && projection.stationM < item.end);
      const content = document.createElement('div'); content.className = 'km-pop';
      const label = document.createElement('span'); label.textContent = pack?.id || 'FICO';
      const km = document.createElement('strong'); km.textContent = `KM ${formatKm(projection.stationM)}`; content.append(label, km);
      if (!kmPopup) kmPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      kmPopup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    });
    map.on('mouseout', () => { if (!hoveredEquipmentId) { operationPopup?.remove(); kmPopup?.remove(); map.getCanvas().style.cursor = ''; } });
    fitRailway(); renderMap(); renderEquipmentMarkers();
  });
}

function operationalFeatures(items, type) {
  const helpers = { sliceAxis, pointAtStation };
  return items.flatMap((item) => (type === 'ldl' ? item.lines : [item.line_id]).map((lineId) => {
    const code = displayCode(item, type === 'ldl' ? 'LDL' : type === 'circulation' ? 'CIRC' : 'PERM');
    const shared = { kind: type, code, km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}` };
    const properties = type === 'ldl'
      ? { ...shared, category: 'LDL · TRECHO BLOQUEADO', headline: `${item.requester_name || item.requester_code} · ${item.workforce_count} pessoas`, line: lineLabel(lineId), timing: `Prevista até ${formatTime(item.requested_end)}`, detail: item.work_description || '' }
      : type === 'circulation'
        ? { ...shared, category: 'CIRCULAÇÃO AUTORIZADA', headline: `${tractionLabel(item)} · ${item.equipment_name || item.direction || 'Circulação'}`, line: lineLabel(item.line_id), timing: `${item.direction || 'circulação'} · prevista até ${formatTime(item.planned_end)}`, detail: compositionLabel(item) }
        : { ...shared, category: 'OPERAÇÃO PERMISSIVA · 15 KM/H', headline: `${item.equipment_id} · ${item.equipment_name || 'Equipamento'}`, line: lineLabel(item.line_id), timing: `Velocidade máxima 15 km/h · até ${formatTime(item.planned_end)}`, detail: item.work_description || item.justification || '' };
    return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: lineCoordinates(lineId, Number(item.km_start), Number(item.km_end), helpers) } };
  }));
}
function renderMap() {
  if (!map?.getSource('ldl')) return;
  map.getSource('ldl').setData({ type: 'FeatureCollection', features: operationalFeatures(operations.ldls, 'ldl') });
  map.getSource('circulation').setData({ type: 'FeatureCollection', features: operationalFeatures(operations.circulations, 'circulation') });
  map.getSource('permissive').setData({ type: 'FeatureCollection', features: operationalFeatures(operations.permissives, 'permissive') });
}
function fitRailway() { if (!map || !axis.length) return; const bounds = new maplibregl.LngLatBounds(); axis.forEach((point) => bounds.extend(point.coordinate)); map.fitBounds(bounds, { padding: { top: 100, right: 70, bottom: 60, left: 70 }, maxZoom: 9, duration: 700 }); }
function renderEquipmentMarkers() {
  if (!map) return;
  for (const item of equipment) {
    if (!item.receivedAt) { markers.get(item.equipmentId)?.remove(); markers.delete(item.equipmentId); continue; }
    const projection = projectToAxis(item.longitude, item.latitude); if (!projection) continue;
    let marker = markers.get(item.equipmentId);
    if (!marker) {
      const element = document.createElement('div'); element.className = 'equipment-marker'; element.dataset.label = item.equipmentId; element.tabIndex = 0; element.setAttribute('role', 'button');
      marker = new maplibregl.Marker({ element }).setLngLat(projection.coordinate).addTo(map); markers.set(item.equipmentId, marker);
      const current = () => equipment.find((entry) => entry.equipmentId === item.equipmentId);
      element.addEventListener('mouseenter', () => { hoveredEquipmentId = item.equipmentId; showEquipmentPopup(current()); });
      element.addEventListener('focus', () => { hoveredEquipmentId = item.equipmentId; showEquipmentPopup(current()); });
      element.addEventListener('mouseleave', () => { hoveredEquipmentId = null; equipmentPopup?.remove(); });
      element.addEventListener('blur', () => { hoveredEquipmentId = null; equipmentPopup?.remove(); });
    }
    marker.setLngLat(projection.coordinate); marker.getElement().className = `equipment-marker ${equipmentStatus(item)}`;
    marker.getElement().setAttribute('aria-label', `${item.equipmentId}, KM ${formatKm(projection.stationM)}. Passe o mouse para ver os detalhes.`);
  }
}

function operationRows() {
  const rows = [];
  for (const item of operations.ldls) rows.push({ type: 'ldl', code: displayCode(item, 'LDL'), title: `${item.workforce_count} pessoas protegidas`, line: item.lines.map(lineLabel).join(' + '), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, end: item.requested_end });
  for (const item of operations.permissives) rows.push({ type: 'permissive', code: displayCode(item, 'PERM'), title: `${item.equipment_id} · máximo 15 km/h`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, end: item.planned_end });
  for (const item of operations.circulations) rows.push({ type: 'circulation', code: displayCode(item, 'CIRC'), title: `${tractionLabel(item)} · ${compositionLabel(item)}`, line: lineLabel(item.line_id), km: `${formatKm(item.km_start)}–${formatKm(item.km_end)}`, end: item.planned_end });
  const priority = { ldl: 0, permissive: 1, circulation: 2 };
  return rows.sort((a, b) => priority[a.type] - priority[b.type] || Number(a.km.split('+')[0]) - Number(b.km.split('+')[0]));
}
function renderOperations() {
  const rows = operationRows(); els.operationTotal.textContent = rows.length; els.operations.replaceChildren();
  if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Via livre · nenhum registro operacional aberto.'; els.operations.append(empty); return; }
  for (const item of rows.slice(0, 8)) {
    const row = document.createElement('article'); row.className = `operation ${item.type}`; row.innerHTML = '<span class="code"></span><div><strong></strong><small></small></div><span class="km"></span>';
    row.querySelector('.code').textContent = item.code; row.querySelector('strong').textContent = item.title; row.querySelector('small').textContent = `${item.line} · até ${formatTime(item.end)}`; row.querySelector('.km').textContent = item.km; els.operations.append(row);
  }
}
function buildAlerts() {
  const alerts = [], now = Date.now();
  for (const event of operations.safetyEvents || []) if (event.status === 'active') alerts.push({ high: true, safety: true, title: `INVASÃO DE LDL · ${event.equipment_id}`, text: `${event.ldl_code} · KM ${formatKm(event.station_m)} · ${Number(event.speed_kmh || 0).toFixed(1).replace('.', ',')} km/h` });
  for (const row of operationRows()) { const minutes = (Date.parse(row.end) - now) / 60000; if (minutes < 0) alerts.push({ high: true, title: `${row.code} com prazo vencido`, text: `${row.line} · ${row.km}` }); else if (minutes <= 15) alerts.push({ high: true, title: `${row.code} termina em ${Math.ceil(minutes)} min`, text: `${row.line} · ${row.km}` }); else if (minutes <= 30) alerts.push({ title: `${row.code} termina em ${Math.ceil(minutes)} min`, text: 'CCO deve confirmar encerramento ou prorrogação.' }); }
  for (const item of equipment) { const status = equipmentStatus(item), projection = item.receivedAt ? projectToAxis(item.longitude, item.latitude) : null; if (status === 'offline') alerts.push({ high: true, title: `${item.equipmentId} offline`, text: `Sem sinal há ${age(item.receivedAt)}` }); else if (status === 'unstable') alerts.push({ title: `${item.equipmentId} instável`, text: `Último sinal há ${age(item.receivedAt)}` }); if (projection?.distanceM > 100) alerts.push({ high: true, title: `${item.equipmentId} fora da faixa`, text: `${Math.round(projection.distanceM)} m do eixo ferroviário` }); }
  return alerts;
}
function renderAlerts() {
  const alerts = buildAlerts(); els.alertTotal.textContent = alerts.length; els.asideAlertCount.textContent = alerts.length; els.alertList.replaceChildren();
  if (!alerts.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Nenhum alerta imediato.'; els.alertList.append(empty); }
  else for (const item of alerts.slice(0, 5)) { const row = document.createElement('article'); row.className = `alert-item ${item.high ? 'high' : ''}`; row.innerHTML = '<strong></strong><span></span>'; row.querySelector('strong').textContent = item.title; row.querySelector('span').textContent = item.text; els.alertList.append(row); }
  const critical = (operations.safetyEvents || []).filter((item) => item.status === 'active'); els.criticalBanner.hidden = !critical.length; els.criticalText.textContent = critical.map((item) => `${item.equipment_id} dentro de ${item.ldl_code} no KM ${formatKm(item.station_m)}`).join(' · ');
  if (critical.length && safetyAudio.enabled) { const signature = critical.map((item) => item.id).sort().join('|'); if (signature !== lastCriticalSignature || Date.now() - lastCriticalSoundAt >= 30000) { safetyAudio.critical(); lastCriticalSignature = signature; lastCriticalSoundAt = Date.now(); } } else if (!critical.length) lastCriticalSignature = '';
  if (safetyAudio.enabled) { const signature = alerts.filter((item) => !item.safety).map((item) => item.title).sort().join('|'); if (signature && signature !== lastWarningSignature) safetyAudio.warning(); lastWarningSignature = signature; }
}
function renderFleet() {
  els.fleet.replaceChildren();
  for (const item of equipment) {
    const status = equipmentStatus(item), projection = item.receivedAt ? projectToAxis(item.longitude, item.latitude) : null, card = document.createElement('button');
    card.className = `unit ${status}`; card.innerHTML = '<strong></strong><span></span><small></small>';
    card.querySelector('strong').textContent = item.equipmentId; card.querySelector('span').textContent = projection ? `KM ${formatKm(projection.stationM)}` : 'SEM SINAL'; card.querySelector('small').textContent = item.receivedAt ? `${(Number(item.speedMps || 0) * 3.6).toFixed(1).replace('.', ',')} km/h · ${age(item.receivedAt)}` : (item.name || item.type);
    if (projection) card.onclick = () => map.easeTo({ center: projection.coordinate, zoom: 14, duration: 700 }); els.fleet.append(card);
  }
}
function render() {
  els.ldl.textContent = operations.ldls.length; els.people.textContent = operations.ldls.reduce((sum, item) => sum + Number(item.workforce_count || 0), 0); els.circulations.textContent = operations.circulations.length; els.permissives.textContent = operations.permissives.length; els.online.textContent = equipment.filter((item) => equipmentStatus(item) === 'online').length;
  renderOperations(); renderAlerts(); renderFleet(); renderMap(); renderEquipmentMarkers();
}
async function load() {
  try {
    const [equipmentResponse, operationsResponse] = await Promise.all([fetch(`${API}/api/v1/equipment/latest`, { cache: 'no-store' }), fetch(`${API}/api/v1/cco/public/operations`, { cache: 'no-store' })]);
    if (!equipmentResponse.ok || !operationsResponse.ok) throw new Error(`HTTP ${equipmentResponse.status}/${operationsResponse.status}`);
    const equipmentData = await equipmentResponse.json(), operationsData = await operationsResponse.json();
    equipment = (equipmentData.equipment || []).sort((a, b) => a.equipmentId.localeCompare(b.equipmentId));
    operations = { ldls: operationsData.ldls || [], circulations: operationsData.circulations || [], permissives: operationsData.permissives || [], safetyEvents: operationsData.safetyEvents || [] };
    lastSuccess = Date.now(); els.connection.textContent = 'MONITORAMENTO AO VIVO'; els.updated.textContent = `Dados renovados às ${new Date(lastSuccess).toLocaleTimeString('pt-BR')} · ciclo de 5 s`; document.querySelector('.live').classList.remove('stale'); render();
  } catch (error) { els.connection.textContent = 'CONEXÃO INTERROMPIDA'; els.updated.textContent = `Mantendo última leitura · ${error.message}`; document.querySelector('.live').classList.add('stale'); }
}

document.querySelectorAll('[data-basemap]').forEach((button) => button.onclick = () => { const satellite = button.dataset.basemap === 'satellite'; if (!map) return; map.setLayoutProperty('osm', 'visibility', satellite ? 'none' : 'visible'); map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none'); document.querySelectorAll('[data-basemap]').forEach((item) => item.classList.toggle('active', item === button)); });
els.fit.onclick = fitRailway;
els.fullscreen.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
document.addEventListener('fullscreenchange', () => els.fullscreen.textContent = document.fullscreenElement ? 'SAIR DA TELA CHEIA' : 'TELA CHEIA');
setInterval(() => { const now = new Date(); els.clock.textContent = now.toLocaleTimeString('pt-BR'); els.today.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(now); if (lastSuccess && Date.now() - lastSuccess > 15000) document.querySelector('.live').classList.add('stale'); }, 1000);
fetch(AXIS_URL).then((response) => response.json()).then((data) => { prepareAxis(data.points); initMap(); load(); setInterval(load, 5000); }).catch((error) => { els.connection.textContent = 'TRAÇADO INDISPONÍVEL'; els.updated.textContent = error.message; document.querySelector('.live').classList.add('stale'); });
