'use strict';

const API_BASE = 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../mapa-superestrutura/assets/data/fico-axis-full.json';
const TYPE_LABELS = { locomotiva: 'Locomotiva', socadora: 'Socadora de via', reguladora: 'Reguladora de lastro', ntc: 'New Track Construction' };
const TYPE_MARKS = { locomotiva: 'L', socadora: 'S', reguladora: 'R', ntc: 'N' };
const PACKAGES = [
  { id: 'P01', name: 'Pacote 01', start: 0, end: 38100, color: '#0075a9' },
  { id: 'P02', name: 'Pacote 02', start: 38100, end: 71300, color: '#55a646' },
  { id: 'P03', name: 'Pacote 03', start: 71300, end: 104500, color: '#ee7623' },
  { id: 'P04', name: 'Pacote 04', start: 104500, end: 131260, color: '#7b61a8' },
  { id: 'P05', name: 'Pacote 05', start: 131260, end: 167300, color: '#008a8a' },
  { id: 'P06', name: 'Pacote 06', start: 167300, end: 225000, color: '#c34f5d' },
  { id: 'P07', name: 'Pacote 07', start: 225000, end: 239950, color: '#657583' },
  { id: 'P08', name: 'Pacote 08', start: 239950, end: 292260, color: '#b27a19' }
];
const state = {
  axis: [], map: null, equipment: [], markers: new Map(), popup: null, popupPinnedId: null,
  selectedId: 'LOCO001', latest: null, sound: false, priorOfflineCount: null, historyEquipment: null,
  basemap: 'street', packageMarkers: [], kmPopup: null, initialFitDone: false
};

const $ = (id) => document.getElementById(id);
const els = {
  system: $('system-state'), chip: $('status-chip'), km: $('km-value'), trackDistance: $('track-distance'),
  speed: $('speed-value'), accuracy: $('accuracy-value'), bearing: $('bearing-value'), battery: $('battery-value'),
  last: $('last-update'), coords: $('coordinates'), history: $('history-summary'), historyEquipment: $('history-equipment'),
  recenter: $('recenter'), sound: $('sound-toggle'), fleetList: $('fleet-list'), onlineCount: $('online-count'),
  fleetCount: $('fleet-count'), equipmentName: $('equipment-name'), equipmentType: $('equipment-type'), equipmentMark: $('equipment-mark'),
  fitFleet: $('fit-fleet')
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

function packageAt(stationM) {
  return PACKAGES.find((item) => stationM >= item.start && stationM < item.end) || PACKAGES.at(-1);
}

function packageCollection() {
  const maximum = state.axis.at(-1)?.station_m || 0;
  return {
    type: 'FeatureCollection',
    features: PACKAGES.map((item) => ({
      type: 'Feature', properties: item,
      geometry: { type: 'LineString', coordinates: sliceCoordinates(item.start, Math.min(item.end, maximum)) }
    }))
  };
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

function initMap(axis) {
  state.map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.35, attributionControl: false });
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.on('load', () => {
    state.map.addSource('packages', { type: 'geojson', data: packageCollection() });
    state.map.addLayer({ id: 'package-casing', type: 'line', source: 'packages', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 14, 11], 'line-opacity': .9 } });
    state.map.addLayer({ id: 'package-lines', type: 'line', source: 'packages', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 14, 7], 'line-opacity': .94 } });
    state.map.addLayer({ id: 'package-hit', type: 'line', source: 'packages', paint: { 'line-color': '#ffffff', 'line-width': 24, 'line-opacity': .01 } });
    state.map.addSource('history', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
    state.map.addLayer({ id: 'history', type: 'line', source: 'history', paint: { 'line-color': '#32a6d8', 'line-width': 4, 'line-opacity': .9 } });
    addPackageMarkers();
    state.map.on('mouseenter', 'package-hit', () => { state.map.getCanvas().style.cursor = 'crosshair'; });
    state.map.on('mousemove', 'package-hit', (event) => showKmReadout(event.lngLat));
    state.map.on('mouseleave', 'package-hit', () => { state.map.getCanvas().style.cursor = ''; state.kmPopup?.remove(); });
    state.equipment.forEach(updateMarker);
    setBasemap(state.basemap);
    if (!state.initialFitDone && state.equipment.some((item) => item.receivedAt)) { state.initialFitDone = true; fitFleet(); }
  });
  state.map.on('click', () => { state.popupPinnedId = null; state.popup?.remove(); });
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
    const detail = document.createElement('small'); detail.textContent = item.receivedAt ? ageLabel(item.receivedAt) : 'sem sinal';
    const dot = document.createElement('em'); dot.title = status.replace('_', ' ');
    copy.append(name, detail); button.append(mark, copy, dot);
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
  els.equipmentType.textContent = TYPE_LABELS[item.type] || item.type;
  els.equipmentMark.textContent = TYPE_MARKS[item.type] || 'E';
  els.equipmentMark.className = `equipment-mark ${item.type}`;
  els.historyEquipment.textContent = item.equipmentId;
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
  element.className = `equipment-marker ${item.type} ${effectiveStatus(item)}${item.equipmentId === state.selectedId ? ' selected' : ''}`;
}

function showEquipmentPopup(item) {
  if (!item?.receivedAt || !state.map) return;
  const projection = projectToAxis(item.longitude, item.latitude);
  const onTrack = projection && projection.distanceM <= 500;
  const content = document.createElement('div'); content.className = 'equipment-popup-card';
  const header = document.createElement('div'); header.className = 'popup-head';
  const identity = document.createElement('span'); identity.textContent = item.equipmentId;
  const status = document.createElement('b'); status.className = effectiveStatus(item); status.textContent = effectiveStatus(item).replace('_', ' ').toUpperCase();
  header.append(identity, status);
  const km = document.createElement('strong'); km.textContent = onTrack ? `KM ${formatKm(projection.stationM)}` : 'FORA DA VIA';
  const detail = document.createElement('small'); detail.textContent = projection ? `${Math.round(projection.distanceM).toLocaleString('pt-BR')} m do eixo · sinal ${ageLabel(item.receivedAt)}` : `Sinal ${ageLabel(item.receivedAt)}`;
  content.append(header, km, detail);
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
  const positioned = state.equipment.filter((item) => item.receivedAt && Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
  if (positioned.length === 1) {
    state.map.easeTo({ center: [positioned[0].longitude, positioned[0].latitude], zoom: 13, duration: 800 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  if (positioned.length) positioned.forEach((item) => bounds.extend([item.longitude, item.latitude]));
  else state.axis.forEach((point) => bounds.extend(point.coordinate));
  state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 45 : 85, maxZoom: 13, duration: 900 });
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
  } catch (error) {
    els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Serviço de rastreamento indisponível';
    console.warn('Falha ao consultar posições', error);
  }
}

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
    if (state.map?.getSource('history')) state.map.getSource('history').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: positions.map((p) => [p.longitude, p.latitude]) } });
    els.history.textContent = positions.length ? `${positions.length.toLocaleString('pt-BR')} posições recebidas no período.` : 'Ainda não há percurso registrado nas últimas 24 horas.';
  } catch { if (state.historyEquipment === id) els.history.textContent = 'Não foi possível carregar o percurso recente.'; }
}

els.sound.addEventListener('click', () => {
  state.sound = !state.sound; els.sound.setAttribute('aria-pressed', String(state.sound));
  els.sound.lastChild.textContent = state.sound ? ' Som ativo' : ' Ativar som'; if (state.sound) alertSound();
});
els.recenter.addEventListener('click', () => state.latest?.receivedAt && state.map.easeTo({ center: [state.latest.longitude, state.latest.latitude], zoom: 14, duration: 700 }));
els.fitFleet.addEventListener('click', fitFleet);
document.querySelectorAll('[data-basemap]').forEach((button) => button.addEventListener('click', () => setBasemap(button.dataset.basemap)));

fetch(AXIS_URL).then((response) => response.json()).then((data) => {
  state.axis = data.points; initMap(state.axis); loadLatest();
  setInterval(loadLatest, 5000);
  setInterval(() => { const selected = currentEquipment(state.selectedId); if (selected) { renderFleetState(); renderSelected(selected); } }, 1000);
}).catch((error) => {
  els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Traçado ferroviário indisponível'; console.error(error);
});
