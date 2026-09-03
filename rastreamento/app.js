import { analyzeProjectedTrack } from './operacao/motion.js';
import { addInfrastructureLayers } from './rail-infrastructure-map.js?v=20260811-2';
import { lineCoordinates, LINE_LABELS } from './rail-infrastructure.js?v=20260811-2';
import { RAIL_PACKAGES as PACKAGES, packageAt, packageCollection as buildPackageCollection } from './rail-packages.js?v=20260811-1';

'use strict';

const API_BASE = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../mapa-superestrutura/assets/data/fico-axis-full.json';
const TYPE_LABELS = { locomotiva: 'Locomotiva', socadora: 'Socadora de via', reguladora: 'Reguladora de lastro', ntc: 'New Track Construction' };
const TYPE_MARKS = { locomotiva: 'L', socadora: 'S', reguladora: 'R', ntc: 'N' };
const state = {
  axis: [], map: null, equipment: [], markers: new Map(), popup: null, popupPinnedId: null,
  selectedId: 'LOCO001', latest: null, sound: false, priorOfflineCount: null, historyEquipment: null,
  basemap: 'street', packageMarkers: [], kmPopup: null, initialFitDone: false,
  operations: { ldls: [], circulations: [], permissives: [], serverTime: null }, operationMarkers: [], operationPopup: null, operationsUnavailable: false,
  refresh: { equipmentTimer: null, operationsTimer: null, equipmentFailures: 0, operationsFailures: 0 }
};

const $ = (id) => document.getElementById(id);
const els = {
  system: $('system-state'), chip: $('status-chip'), km: $('km-value'), trackDistance: $('track-distance'),
  speed: $('speed-value'), accuracy: $('accuracy-value'), bearing: $('bearing-value'), battery: $('battery-value'),
  last: $('last-update'), coords: $('coordinates'), history: $('history-summary'), historyEquipment: $('history-equipment'),
  recenter: $('recenter'), sound: $('sound-toggle'), fleetList: $('fleet-list'), onlineCount: $('online-count'),
  fleetCount: $('fleet-count'), equipmentName: $('equipment-name'), equipmentAlias: $('equipment-alias'), equipmentType: $('equipment-type'), equipmentDescription: $('equipment-description'), equipmentMark: $('equipment-mark'),
  fitFleet: $('fit-fleet'), fitBlocks: $('fit-blocks'), operatorName: $('operator-name'), operatorDetail: $('operator-detail'), operatorAction: $('operator-action'),
  railOperations: $('rail-operations'), railOperationStatus: $('rail-operation-status'), railOperationDetail: $('rail-operation-detail'), railOperationItems: $('rail-operation-items')
};

function mapStyle() {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
      satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Esri' }
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.7, 'raster-contrast': 0.08, 'raster-brightness-max': 0.92 } },
      { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }
    ]
  };
}

function pointAtStation(target) {
  if (!state.axis.length) return null;
  if (target <= state.axis[0].station_m) return state.axis[0].coordinate;
  if (target >= state.axis[state.axis.length - 1].station_m) return state.axis[state.axis.length - 1].coordinate;
  let low = 0, high = state.axis.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (state.axis[middle].station_m <= target) low = middle; else high = middle;
  }
  const before = state.axis[low], after = state.axis[high];
  const ratio = (target - before.station_m) / Math.max(1, after.station_m - before.station_m);
  return [before.coordinate[0] + (after.coordinate[0] - before.coordinate[0]) * ratio, before.coordinate[1] + (after.coordinate[1] - before.coordinate[1]) * ratio];
}

function sliceCoordinates(start, end) {
  const coordinates = [pointAtStation(start)];
  state.axis.forEach((point) => { if (point.station_m > start && point.station_m < end) coordinates.push(point.coordinate); });
  coordinates.push(pointAtStation(end));
  return coordinates.filter(Boolean);
}

function packageCollection() {
  return buildPackageCollection(sliceCoordinates, state.axis.at(-1)?.station_m || 0);
}

function addPackageMarkers() {
  state.packageMarkers.forEach((marker) => marker.remove());
  state.packageMarkers = PACKAGES.map((item) => {
    const element = document.createElement('div');
    element.className = 'package-map-label'; element.textContent = item.id; element.style.setProperty('--package', item.color);
    element.title = `${item.name} · KM ${formatKm(item.start)} — ${formatKm(Math.min(item.end, state.axis.at(-1).station_m))}`;
    return new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(pointAtStation((item.start + Math.min(item.end, state.axis.at(-1).station_m)) / 2)).addTo(state.map);
  });
}

function showKmReadout(lngLat) {
  const projection = projectToAxis(lngLat.lng, lngLat.lat);
  if (!projection) return;
  const pack = packageAt(projection.stationM);
  const content = document.createElement('div'); content.className = 'km-readout';
  const packageName = document.createElement('span'); packageName.textContent = pack.name;
  const km = document.createElement('strong'); km.textContent = `KM ${formatKm(projection.stationM)}`;
  content.append(packageName, km);
  if (!state.kmPopup) state.kmPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 13, className: 'km-popup' });
  state.kmPopup.setLngLat(lngLat).setDOMContent(content).addTo(state.map);
}

function operationCode(item, prefix) { return `${prefix} ${String(item.sequence_number).padStart(3, '0')}`; }
function operationDate(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function operationLineLabel(id) { return LINE_LABELS[id] || id; }

function operationCollections() {
  const helpers = { sliceAxis: sliceCoordinates, pointAtStation };
  const ldlFeatures = (state.operations.ldls || []).flatMap((item) => item.lines.map((lineId) => ({
    type: 'Feature', properties: { id: item.id, kind: 'ldl', lineId }, geometry: { type: 'LineString', coordinates: lineCoordinates(lineId, Number(item.km_start), Number(item.km_end), helpers) }
  })));
  const permissiveFeatures = (state.operations.permissives || []).map((item) => ({
    type: 'Feature', properties: { id: item.id, kind: 'permissive', lineId: item.line_id }, geometry: { type: 'LineString', coordinates: lineCoordinates(item.line_id, Number(item.km_start), Number(item.km_end), helpers) }
  }));
  return {
    ldls: { type: 'FeatureCollection', features: ldlFeatures },
    permissives: { type: 'FeatureCollection', features: permissiveFeatures }
  };
}

function findOperation(kind, id) { return (kind === 'ldl' ? state.operations.ldls : state.operations.permissives).find((item) => item.id === id); }

function showOperationPopup(item, kind, lngLat) {
  if (!item || !state.map) return;
  const isLdl = kind === 'ldl', card = document.createElement('article'); card.className = `operation-popup-card${isLdl ? '' : ' permissive'}`;
  const header = document.createElement('header'), title = document.createElement('strong'), badge = document.createElement('span');
  title.textContent = operationCode(item, isLdl ? 'LDL' : 'PERM');
  badge.textContent = isLdl ? (Date.parse(item.requested_end) < Date.now() ? 'VENCIDA · BLOQUEIO MANTIDO' : 'TRECHO BLOQUEADO') : 'OPERAÇÃO CONJUNTA';
  header.append(title, badge);
  const body = document.createElement('div'); body.className = 'operation-popup-body';
  const km = document.createElement('b'); km.textContent = `KM ${formatKm(item.km_start)}–${formatKm(item.km_end)}`;
  const line = document.createElement('span'); line.textContent = isLdl ? item.lines.map(operationLineLabel).join(' + ') : operationLineLabel(item.line_id);
  const restriction = document.createElement('span'); restriction.className = 'restriction'; restriction.textContent = isLdl ? 'CIRCULAÇÃO BLOQUEADA' : `VELOCIDADE MÁXIMA ${item.speed_limit_kmh} KM/H`;
  const service = document.createElement('small'); service.textContent = `Serviço: ${item.work_description}`;
  const responsible = document.createElement('small'); responsible.textContent = isLdl ? `Responsável: ${item.requester_code} · ${item.requester_name}${item.company ? ` · ${item.company}` : ''} · ${item.workforce_count} pessoas` : `Equipamento: ${item.equipment_id} · ${item.equipment_name}`;
  const linked = document.createElement('small'); linked.textContent = isLdl ? `Vigência: ${operationDate(item.requested_start)} → ${operationDate(item.requested_end)}` : `Vinculado a: ${(item.links || []).map((link) => link.code || link.kind).join(' + ')} · ${operationDate(item.planned_start)} → ${operationDate(item.planned_end)}`;
  body.append(km, line, restriction, service, responsible, linked); card.append(header, body);
  if (!state.operationPopup) state.operationPopup = new maplibregl.Popup({ closeButton: true, offset: 18, className: 'operation-popup' });
  state.operationPopup.setLngLat(lngLat).setDOMContent(card).addTo(state.map);
}

function renderOperationMarkers() {
  state.operationMarkers.forEach((marker) => marker.remove()); state.operationMarkers = [];
  if (!state.map?.getSource('ldl-blocks')) return;
  for (const item of state.operations.ldls) {
    const element = document.createElement('button'); element.type = 'button'; element.className = `ldl-map-label${Date.parse(item.requested_end) < Date.now() ? ' expired' : ''}`; element.textContent = operationCode(item, 'LDL');
    element.setAttribute('aria-label', `${operationCode(item, 'LDL')}, trecho bloqueado do KM ${formatKm(item.km_start)} ao ${formatKm(item.km_end)}.`);
    const coordinate = pointAtStation((Number(item.km_start) + Number(item.km_end)) / 2);
    const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(coordinate).addTo(state.map);
    element.addEventListener('click', (event) => { event.stopPropagation(); showOperationPopup(item, 'ldl', coordinate); });
    state.operationMarkers.push(marker);
  }
}

function focusOperation(item, kind) {
  if (!state.map) return;
  const lineId = kind === 'ldl' ? item.lines[0] : item.line_id, coordinates = lineCoordinates(lineId, Number(item.km_start), Number(item.km_end), { sliceAxis: sliceCoordinates, pointAtStation }), bounds = new maplibregl.LngLatBounds(); coordinates.forEach((coordinate) => bounds.extend(coordinate));
  state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 65 : 125, maxZoom: 14, duration: 800 });
  const center = pointAtStation((Number(item.km_start) + Number(item.km_end)) / 2); setTimeout(() => showOperationPopup(item, kind, center), 850);
}

function renderOperationItems() {
  els.railOperationItems.replaceChildren();
  for (const [kind, items] of [['ldl', state.operations.ldls], ['permissive', state.operations.permissives]]) for (const item of items) {
    const onMap = true, node = document.createElement('button');
    if (onMap) node.type = 'button'; node.className = `rail-operation-item${kind === 'permissive' ? ' permissive' : ''}`; node.dataset.map = String(onMap);
    const code = document.createElement('b'); code.textContent = operationCode(item, kind === 'ldl' ? 'LDL' : 'PERM');
    const detail = document.createTextNode(`KM ${formatKm(item.km_start)}–${formatKm(item.km_end)} · ${kind === 'ldl' ? item.lines.map(operationLineLabel).join(' + ') : `${operationLineLabel(item.line_id)} · 15 km/h`}`);
    node.append(code, detail); if (onMap) node.addEventListener('click', () => focusOperation(item, kind)); els.railOperationItems.append(node);
  }
}

function renderRailOperations() {
  const ldls = state.operations.ldls || [], permissives = state.operations.permissives || [], lines = [...new Set(ldls.flatMap((item) => item.lines).concat(permissives.map((item) => item.line_id)))].map(operationLineLabel);
  const collections = operationCollections();
  state.map?.getSource('ldl-blocks')?.setData(collections.ldls); state.map?.getSource('permissive-operations')?.setData(collections.permissives); renderOperationMarkers(); renderOperationItems();
  if (state.operationsUnavailable) {
    els.railOperations.className = 'rail-operations unavailable'; els.railOperationStatus.textContent = 'ATUALIZAÇÃO DO CCO INTERROMPIDA'; els.railOperationDetail.textContent = `Última situação conhecida mantida no mapa${state.operations.serverTime ? ` · ${ageLabel(state.operations.serverTime)}` : ''}.`; return;
  }
  els.railOperations.className = `rail-operations ${ldls.length ? 'blocked' : permissives.length ? 'permissive' : 'clear'}`;
  els.railOperations.querySelector('.rail-operation-icon').textContent = ldls.length ? '!' : permissives.length ? '15' : '✓';
  els.railOperationStatus.textContent = ldls.length ? `${ldls.length} ${ldls.length === 1 ? 'LDL ATIVA' : 'LDLs ATIVAS'} · VIA BLOQUEADA` : permissives.length ? `${permissives.length} ${permissives.length === 1 ? 'PERMISSIVO ATIVO' : 'PERMISSIVOS ATIVOS'}` : 'SEM LDL ATIVA';
  const lineSummary = lines.join(' + ');
  els.railOperationDetail.textContent = `${permissives.length} permissivo${permissives.length === 1 ? '' : 's'} · ${lineSummary || 'linha livre'} · atualizado ${ageLabel(state.operations.serverTime)}`;
  els.fitBlocks.hidden = !collections.ldls.features.length && !collections.permissives.features.length;
}

function fitOperationalSections() {
  if (!state.map) return;
  const collections = operationCollections(), features = [...collections.ldls.features, ...collections.permissives.features];
  if (!features.length) return;
  const bounds = new maplibregl.LngLatBounds(); features.forEach((feature) => feature.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate)));
  state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 55 : 105, maxZoom: 14, duration: 900 });
}

function initMap(axis) {
  state.map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.35, attributionControl: false });
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.on('load', () => {
    state.map.addSource('packages', { type: 'geojson', data: packageCollection() });
    state.map.addLayer({ id: 'package-casing', type: 'line', source: 'packages', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 14, 11], 'line-opacity': .9 } });
    state.map.addLayer({ id: 'package-lines', type: 'line', source: 'packages', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 14, 7], 'line-opacity': .94 } });
    state.map.addLayer({ id: 'package-hit', type: 'line', source: 'packages', paint: { 'line-color': '#ffffff', 'line-width': 24, 'line-opacity': .01 } });
    addInfrastructureLayers(state.map, { sliceAxis: sliceCoordinates, pointAtStation });
    state.map.addSource('history', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
    state.map.addLayer({ id: 'history', type: 'line', source: 'history', paint: { 'line-color': '#32a6d8', 'line-width': 4, 'line-opacity': .9 } });
    state.map.addSource('ldl-blocks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    state.map.addLayer({ id: 'ldl-block-casing', type: 'line', source: 'ldl-blocks', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 12, 14, 18], 'line-opacity': .98 } });
    state.map.addLayer({ id: 'ldl-blocks', type: 'line', source: 'ldl-blocks', paint: { 'line-color': '#c83f39', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 7, 14, 12], 'line-opacity': .98 } });
    state.map.addSource('permissive-operations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    state.map.addLayer({ id: 'permissive-casing', type: 'line', source: 'permissive-operations', paint: { 'line-color': '#082b4c', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 10, 14, 15], 'line-opacity': .95 } });
    state.map.addLayer({ id: 'permissive-operations', type: 'line', source: 'permissive-operations', paint: { 'line-color': '#f4c430', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 14, 9], 'line-dasharray': [1.2, .8] } });
    addPackageMarkers();
    state.map.on('mouseenter', 'package-hit', () => { state.map.getCanvas().style.cursor = 'crosshair'; });
    state.map.on('mousemove', 'package-hit', (event) => showKmReadout(event.lngLat));
    state.map.on('mouseleave', 'package-hit', () => { state.map.getCanvas().style.cursor = ''; state.kmPopup?.remove(); });
    for (const layer of ['ldl-blocks', 'permissive-operations']) {
      state.map.on('mouseenter', layer, () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', layer, () => { state.map.getCanvas().style.cursor = ''; });
      state.map.on('click', layer, (event) => { const feature = event.features?.[0], item = feature && findOperation(feature.properties.kind, feature.properties.id); if (item) showOperationPopup(item, feature.properties.kind, event.lngLat); });
    }
    state.equipment.forEach(updateMarker);
    renderRailOperations();
    setBasemap(state.basemap);
    if (!state.initialFitDone && state.equipment.some((item) => item.receivedAt)) { state.initialFitDone = true; fitFleet(); }
  });
  state.map.on('click', (event) => {
    state.popupPinnedId = null; state.popup?.remove();
    const operationHit = state.map.queryRenderedFeatures(event.point, { layers: ['ldl-blocks', 'permissive-operations'] });
    if (!operationHit.length) state.operationPopup?.remove();
  });
}

function projectToAxis(lon, lat) {
  let best = null;
  const cos = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < state.axis.length - 1; i++) {
    const a = state.axis[i], b = state.axis[i + 1];
    const ax = (a.coordinate[0] - lon) * cos, ay = a.coordinate[1] - lat;
    const bx = (b.coordinate[0] - lon) * cos, by = b.coordinate[1] - lat;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + t * dx, py = ay + t * dy, d2 = px * px + py * py;
    if (!best || d2 < best.d2) best = { d2, t, a, b, coordinate: [a.coordinate[0] + t * (b.coordinate[0] - a.coordinate[0]), a.coordinate[1] + t * (b.coordinate[1] - a.coordinate[1])] };
  }
  if (!best) return null;
  return { stationM: best.a.station_m + best.t * (best.b.station_m - best.a.station_m), distanceM: Math.sqrt(best.d2) * 111320, coordinate: best.coordinate };
}

function formatKm(stationM) {
  const rounded = Math.max(0, Math.round(stationM));
  return `${Math.floor(rounded / 1000)}+${String(rounded % 1000).padStart(3, '0')}`;
}

function ageLabel(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return 'agora';
  if (seconds < 60) return `há ${seconds} segundos`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

function direction(deg) {
  if (deg == null) return '—';
  return ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(Number(deg) / 45) % 8];
}

function effectiveStatus(item) {
  if (!item?.receivedAt) return 'sem_sinal';
  const age = Date.now() - Date.parse(item.receivedAt);
  return age <= 30000 ? 'online' : age <= 120000 ? 'instavel' : 'offline';
}

function alertSound() {
  if (!state.sound) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  [0, .24].forEach((delay) => {
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.frequency.value = 680; oscillator.type = 'square'; gain.gain.value = .055;
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(ctx.currentTime + delay); oscillator.stop(ctx.currentTime + delay + .15);
  });
}

function renderFleetState() {
  const counts = { online: 0, instavel: 0, offline: 0, sem_sinal: 0 };
  state.equipment.forEach((item) => counts[effectiveStatus(item)]++);
  els.onlineCount.textContent = counts.online;
  els.fleetCount.textContent = `${state.equipment.length} equipamentos cadastrados`;
  const details = [`${counts.online} online`, `${counts.instavel} instáveis`, `${counts.offline} offline`, `${counts.sem_sinal} sem sinal`];
  els.system.className = `system-state ${counts.online ? 'online' : counts.instavel ? 'waiting' : counts.offline ? 'offline' : 'waiting'}`;
  els.system.querySelector('span').textContent = details.join(' · ');
  if (state.priorOfflineCount != null && counts.offline > state.priorOfflineCount) alertSound();
  state.priorOfflineCount = counts.offline;
}

function renderFleetList() {
  els.fleetList.replaceChildren();
  state.equipment.forEach((item) => {
    const status = effectiveStatus(item);
    const button = document.createElement('button');
    button.type = 'button'; button.className = `fleet-item ${item.type} ${status}${item.equipmentId === state.selectedId ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(item.equipmentId === state.selectedId));
    const mark = document.createElement('i'); mark.textContent = TYPE_MARKS[item.type] || 'E';
    const copy = document.createElement('span');
    const name = document.createElement('b'); name.textContent = item.equipmentId;
    const alias = document.createElement('small'); alias.className = 'fleet-alias'; alias.textContent = item.name || TYPE_LABELS[item.type] || item.equipmentId;
    const detail = document.createElement('small'); detail.className = 'fleet-signal'; detail.textContent = item.receivedAt ? ageLabel(item.receivedAt) : 'sem sinal';
    const dot = document.createElement('em'); dot.title = status.replace('_', ' ');
    copy.append(name, alias, detail); button.append(mark, copy, dot);
    button.addEventListener('click', () => selectEquipment(item.equipmentId, true));
    els.fleetList.append(button);
  });
}

function setSelectedStatus(status) {
  const labels = { online: 'ONLINE', instavel: 'INSTÁVEL', offline: 'OFFLINE', sem_sinal: 'SEM SINAL' };
  els.chip.className = `status-chip ${status}`;
  els.chip.textContent = labels[status];
}

function clearTelemetry() {
  els.km.textContent = '—+———'; els.trackDistance.textContent = 'Aguardando coordenada GPS';
  els.speed.innerHTML = '— <small>km/h</small>'; els.accuracy.innerHTML = '— <small>m</small>';
  els.bearing.textContent = '—'; els.battery.innerHTML = '— <small>%</small>';
  els.last.textContent = 'Nenhum sinal recebido'; els.coords.textContent = 'Latitude — · Longitude —';
  els.recenter.hidden = true;
}

function renderSelected(item) {
  if (!item) return;
  state.latest = item;
  els.equipmentName.textContent = item.equipmentId;
  els.equipmentAlias.textContent = item.name || TYPE_LABELS[item.type] || item.equipmentId;
  els.equipmentType.textContent = TYPE_LABELS[item.type] || item.type;
  els.equipmentDescription.textContent = item.description || '';
  els.equipmentDescription.hidden = !item.description;
  els.equipmentMark.textContent = TYPE_MARKS[item.type] || 'E';
  els.equipmentMark.className = `equipment-mark ${item.type}`;
  els.historyEquipment.textContent = item.equipmentId;
  els.operatorAction.href = `assumir/?equipamento=${encodeURIComponent(item.equipmentId)}`;
  if (item.operatorName) {
    els.operatorName.textContent = item.operatorName;
    els.operatorDetail.textContent = `Matrícula ${item.operatorRegistration} · turno desde ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.shiftStartedAt))}`;
  } else {
    els.operatorName.textContent = 'Nenhum operador identificado';
    els.operatorDetail.textContent = 'Aguardando início de turno';
  }
  setSelectedStatus(effectiveStatus(item));
  if (!item.receivedAt) { clearTelemetry(); return; }
  const projection = projectToAxis(item.longitude, item.latitude);
  const onTrack = projection && projection.distanceM <= 500;
  els.km.textContent = onTrack ? formatKm(projection.stationM) : 'FORA DA VIA';
  els.trackDistance.textContent = projection ? `${Math.round(projection.distanceM).toLocaleString('pt-BR')} m do eixo da linha tronco` : 'Não foi possível projetar no traçado';
  els.speed.innerHTML = `${item.speedMps == null ? '—' : (item.speedMps * 3.6).toFixed(1)} <small>km/h</small>`;
  els.accuracy.innerHTML = `${item.accuracyM == null ? '—' : Math.round(item.accuracyM)} <small>m</small>`;
  els.bearing.textContent = direction(item.bearingDeg);
  els.battery.innerHTML = `${item.batteryPct == null ? '—' : item.batteryPct} <small>%</small>`;
  els.last.textContent = `${ageLabel(item.receivedAt)} · ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date(item.receivedAt))}`;
  els.coords.textContent = `Latitude ${item.latitude.toFixed(6)} · Longitude ${item.longitude.toFixed(6)}`;
  els.recenter.hidden = false;
}

function currentEquipment(id) {
  return state.equipment.find((item) => item.equipmentId === id);
}

function updateMarker(item) {
  if (!item?.receivedAt || !state.map?.loaded()) return;
  const coupled = (state.operations.circulations || []).some((circulation) => (circulation.equipmentMembers || []).some((member) => member.equipmentId === item.equipmentId));
  if (coupled) { state.markers.get(item.equipmentId)?.remove(); state.markers.delete(item.equipmentId); return; }
  let marker = state.markers.get(item.equipmentId);
  if (!marker) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = `equipment-marker ${item.type}`; element.textContent = TYPE_MARKS[item.type] || 'E';
    element.setAttribute('aria-label', `Posição de ${item.equipmentId}. Passe o mouse ou toque para ver o KM.`);
    marker = new maplibregl.Marker({ element }).setLngLat([item.longitude, item.latitude]).addTo(state.map);
    state.markers.set(item.equipmentId, marker);
    element.addEventListener('mouseenter', () => showEquipmentPopup(currentEquipment(item.equipmentId)));
    element.addEventListener('focus', () => showEquipmentPopup(currentEquipment(item.equipmentId)));
    element.addEventListener('mouseleave', () => { if (state.popupPinnedId !== item.equipmentId) state.popup?.remove(); });
    element.addEventListener('blur', () => { if (state.popupPinnedId !== item.equipmentId) state.popup?.remove(); });
    element.addEventListener('click', (event) => {
      event.stopPropagation(); state.popupPinnedId = item.equipmentId;
      selectEquipment(item.equipmentId, false); showEquipmentPopup(currentEquipment(item.equipmentId));
    });
  }
  marker.setLngLat([item.longitude, item.latitude]);
  const element = marker.getElement();
  const markerStatus = effectiveStatus(item);
  element.className = `equipment-marker ${item.type} ${markerStatus}${item.equipmentId === state.selectedId ? ' selected' : ''}`;
  if (markerStatus === 'offline') {
    element.dataset.statusLabel = `Última posição · ${ageLabel(item.receivedAt)}`;
    element.setAttribute('aria-label', `Última posição conhecida de ${item.equipmentId}, recebida ${ageLabel(item.receivedAt)}.`);
  } else {
    delete element.dataset.statusLabel;
    element.setAttribute('aria-label', `Posição de ${item.equipmentId}. Passe o mouse ou toque para ver o KM.`);
  }
}

function showEquipmentPopup(item) {
  if (!item?.receivedAt || !state.map) return;
  const projection = projectToAxis(item.longitude, item.latitude);
  const onTrack = projection && projection.distanceM <= 500;
  const content = document.createElement('div'); content.className = 'equipment-popup-card';
  const header = document.createElement('div'); header.className = 'popup-head';
  const identity = document.createElement('span'); identity.textContent = item.equipmentId;
  const itemStatus = effectiveStatus(item);
  const status = document.createElement('b'); status.className = itemStatus; status.textContent = itemStatus === 'offline' ? 'ÚLTIMA POSIÇÃO' : itemStatus.replace('_', ' ').toUpperCase();
  header.append(identity, status);
  const km = document.createElement('strong'); km.textContent = onTrack ? `KM ${formatKm(projection.stationM)}` : 'FORA DA VIA';
  const signalLabel = itemStatus === 'offline' ? `offline · última atualização ${ageLabel(item.receivedAt)}` : `sinal ${ageLabel(item.receivedAt)}`;
  const detail = document.createElement('small'); detail.textContent = projection ? `${Math.round(projection.distanceM).toLocaleString('pt-BR')} m do eixo · ${signalLabel}` : signalLabel;
  const equipmentDetails = document.createElement('div'); equipmentDetails.className = 'popup-equipment-details';
  const equipmentAlias = document.createElement('b'); equipmentAlias.textContent = item.name || TYPE_LABELS[item.type] || item.equipmentId;
  equipmentDetails.append(equipmentAlias);
  if (item.description) {
    const equipmentDescription = document.createElement('small'); equipmentDescription.textContent = item.description;
    equipmentDetails.append(equipmentDescription);
  }
  const operator = document.createElement('div'); operator.className = 'popup-operator';
  operator.textContent = item.operatorName ? `Operador: ${item.operatorName} · ${item.operatorRegistration}` : 'Operador não identificado';
  const circulation = (state.operations.circulations || []).find((entry) => entry.equipment_id === item.equipmentId || (entry.equipmentMembers || []).some((member) => member.equipmentId === item.equipmentId));
  const formation = document.createElement('small'); formation.textContent = circulation ? `Formação: ${circulation.equipment_id} (comandante)${(circulation.equipmentMembers || []).map((member) => ` + ${member.equipmentId} (${member.operationalRole === 'traction_auxiliary' ? 'auxiliar de tração' : 'rebocado'})`).join('')}` : 'Sem circulação vinculada';
  content.append(header, km, detail, equipmentDetails, operator, formation);
  if (!state.popup) state.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 24, className: 'equipment-popup' });
  state.popup.setLngLat([item.longitude, item.latitude]).setDOMContent(content).addTo(state.map);
}

function selectEquipment(id, fly) {
  const item = currentEquipment(id);
  if (!item) return;
  state.selectedId = id; state.latest = item;
  renderFleetList(); state.equipment.forEach(updateMarker); renderSelected(item); loadHistory(id);
  if (fly && item.receivedAt) state.map?.easeTo({ center: [item.longitude, item.latitude], zoom: Math.max(state.map.getZoom(), 13), duration: 800 });
}

function fitFleet() {
  if (!state.map || !state.axis.length) return;
  document.querySelectorAll('[data-package]').forEach((button) => button.classList.remove('active'));
  const coupledIds = new Set((state.operations.circulations || []).flatMap((circulation) => (circulation.equipmentMembers || []).map((member) => member.equipmentId)));
  const positioned = state.equipment.filter((item) => item.receivedAt && !coupledIds.has(item.equipmentId) && Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
  if (positioned.length === 1) {
    state.map.easeTo({ center: [positioned[0].longitude, positioned[0].latitude], zoom: 13, duration: 800 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  if (positioned.length) positioned.forEach((item) => bounds.extend([item.longitude, item.latitude]));
  else state.axis.forEach((point) => bounds.extend(point.coordinate));
  state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 45 : 85, maxZoom: 13, duration: 900 });
}

function focusPackage(packageId) {
  if (!state.map || !state.axis.length) return;
  const selectedPackage = PACKAGES.find((item) => item.id === packageId);
  if (!selectedPackage) return;
  const maximum = state.axis.at(-1).station_m;
  const coordinates = sliceCoordinates(selectedPackage.start, Math.min(selectedPackage.end, maximum));
  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 55 : 105, maxZoom: 14, duration: 900 });
  document.querySelectorAll('[data-package]').forEach((button) => {
    const active = button.dataset.package === packageId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setBasemap(mode) {
  state.basemap = mode;
  if (!state.map?.loaded()) return;
  state.map.setLayoutProperty('osm', 'visibility', mode === 'street' ? 'visible' : 'none');
  state.map.setLayoutProperty('satellite', 'visibility', mode === 'satellite' ? 'visible' : 'none');
  document.querySelectorAll('[data-basemap]').forEach((button) => {
    const active = button.dataset.basemap === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

async function loadLatest() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/equipment/latest`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const typeOrder = { locomotiva: 0, socadora: 1, reguladora: 2, ntc: 3 };
    state.equipment = (data.equipment || []).sort((a, b) => (typeOrder[a.type] - typeOrder[b.type]) || a.equipmentId.localeCompare(b.equipmentId));
    renderFleetState(); renderFleetList(); state.equipment.forEach(updateMarker);
    const selected = currentEquipment(state.selectedId) || state.equipment[0];
    if (selected) { state.selectedId = selected.equipmentId; renderSelected(selected); if (selected.receivedAt && state.historyEquipment !== selected.equipmentId) loadHistory(selected.equipmentId); }
    if (!state.initialFitDone && state.map?.loaded() && state.equipment.some((item) => item.receivedAt)) { state.initialFitDone = true; fitFleet(); }
    state.refresh.equipmentFailures = 0;
    return true;
  } catch (error) {
    els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Serviço de rastreamento indisponível';
    console.warn('Falha ao consultar posições', error);
    state.refresh.equipmentFailures += 1;
    return false;
  }
}

async function loadRailOperations() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/cco/public/operations`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.operations = { ldls: data.ldls || [], circulations: data.circulations || [], permissives: data.permissives || [], serverTime: data.serverTime };
    state.operationsUnavailable = false; renderRailOperations(); state.equipment.forEach(updateMarker);
    state.refresh.operationsFailures = 0;
    return true;
  } catch (error) {
    state.operationsUnavailable = true; renderRailOperations(); console.warn('Falha ao consultar bloqueios do CCO', error);
    state.refresh.operationsFailures += 1;
    return false;
  }
}

function refreshDelay(baseMs, failures) {
  return Math.min(60_000, baseMs * 2 ** failures);
}

function scheduleEquipmentRefresh() {
  clearTimeout(state.refresh.equipmentTimer);
  if (document.hidden) return;
  state.refresh.equipmentTimer = setTimeout(async () => {
    await loadLatest();
    scheduleEquipmentRefresh();
  }, refreshDelay(10_000, state.refresh.equipmentFailures));
}

function scheduleOperationsRefresh() {
  clearTimeout(state.refresh.operationsTimer);
  if (document.hidden) return;
  state.refresh.operationsTimer = setTimeout(async () => {
    await loadRailOperations();
    scheduleOperationsRefresh();
  }, refreshDelay(30_000, state.refresh.operationsFailures));
}

function scheduleRefreshes() { scheduleEquipmentRefresh(); scheduleOperationsRefresh(); }

async function loadHistory(id) {
  state.historyEquipment = id;
  els.history.textContent = 'Carregando percurso recente…';
  if (state.map?.getSource('history')) state.map.getSource('history').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
  try {
    const response = await fetch(`${API_BASE}/api/v1/equipment/${encodeURIComponent(id)}/history?hours=24&limit=20000`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (state.historyEquipment !== id) return;
    const positions = data.positions || [];
    const projected = positions.map((point) => ({
      ...point,
      projection: projectToAxis(point.longitude, point.latitude),
    }));
    const analysis = analyzeProjectedTrack(projected, {
      deadbandM: 30,
      maxAccuracyM: 40,
      maxRailDistanceM: 500,
    });
    const coordinates = analysis.accepted.map((point) => point.projection.coordinate);
    if (state.map?.getSource('history')) state.map.getSource('history').setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coordinates.length > 1 ? coordinates : [] },
    });
    if (!positions.length) {
      els.history.textContent = 'Ainda não há percurso registrado nas últimas 24 horas.';
    } else if (coordinates.length < 2) {
      els.history.textContent = `${positions.length.toLocaleString('pt-BR')} posições recebidas; equipamento considerado parado pelo filtro de 30 m.`;
    } else {
      els.history.textContent = `${positions.length.toLocaleString('pt-BR')} posições recebidas; percurso corrigido pela precisão do GPS.`;
    }
  } catch { if (state.historyEquipment === id) els.history.textContent = 'Não foi possível carregar o percurso recente.'; }
}

els.sound.addEventListener('click', () => {
  state.sound = !state.sound; els.sound.setAttribute('aria-pressed', String(state.sound));
  els.sound.lastChild.textContent = state.sound ? ' Som ativo' : ' Ativar som'; if (state.sound) alertSound();
});
els.recenter.addEventListener('click', () => state.latest?.receivedAt && state.map.easeTo({ center: [state.latest.longitude, state.latest.latitude], zoom: 14, duration: 700 }));
els.fitFleet.addEventListener('click', fitFleet);
els.fitBlocks.addEventListener('click', fitOperationalSections);
document.querySelectorAll('[data-basemap]').forEach((button) => button.addEventListener('click', () => setBasemap(button.dataset.basemap)));
document.querySelectorAll('[data-package]').forEach((button) => button.addEventListener('click', () => focusPackage(button.dataset.package)));

fetch(AXIS_URL).then((response) => response.json()).then((data) => {
  state.axis = data.points; initMap(state.axis); loadLatest(); loadRailOperations();
  scheduleRefreshes();
  setInterval(() => { const selected = currentEquipment(state.selectedId); if (selected) { renderFleetState(); renderSelected(selected); } }, 1000);
}).catch((error) => {
  els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Traçado ferroviário indisponível'; console.error(error);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) scheduleRefreshes();
  else { loadLatest(); loadRailOperations(); scheduleRefreshes(); }
});
