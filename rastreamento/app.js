'use strict';

const API_BASE = 'https://fico-tracking-api.automacaofico.workers.dev';
const AXIS_URL = '../mapa-superestrutura/assets/data/fico-axis-full.json';
const state = { axis: [], map: null, marker: null, popup: null, popupPinned: false, latest: null, sound: false, priorStatus: 'sem_sinal', historyLoaded: false };

const $ = (id) => document.getElementById(id);
const els = {
  system: $('system-state'), chip: $('status-chip'), km: $('km-value'), trackDistance: $('track-distance'),
  speed: $('speed-value'), accuracy: $('accuracy-value'), bearing: $('bearing-value'), battery: $('battery-value'),
  last: $('last-update'), coords: $('coordinates'), history: $('history-summary'), recenter: $('recenter'), sound: $('sound-toggle')
};

function mapStyle() {
  return { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.7, 'raster-contrast': 0.08, 'raster-brightness-max': 0.92 } }] };
}

function initMap(axis) {
  state.map = new maplibregl.Map({ container: 'map', style: mapStyle(), center: [-50.3, -14.08], zoom: 7.35, attributionControl: false });
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.on('load', () => {
    state.map.addSource('fico-axis', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: axis.map((p) => p.coordinate) } } });
    state.map.addLayer({ id: 'axis-shadow', type: 'line', source: 'fico-axis', paint: { 'line-color': '#082b4c', 'line-width': 7, 'line-opacity': .8 } });
    state.map.addLayer({ id: 'axis', type: 'line', source: 'fico-axis', paint: { 'line-color': '#f28b22', 'line-width': 2.5 } });
    state.map.addSource('history', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
    state.map.addLayer({ id: 'history', type: 'line', source: 'history', paint: { 'line-color': '#32a6d8', 'line-width': 4, 'line-opacity': .9 } });
    if (state.latest) placeMarker(state.latest, false);
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
  return ['N','NE','L','SE','S','SO','O','NO'][Math.round(Number(deg) / 45) % 8];
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

function setStatus(status) {
  const labels = { online: 'ONLINE', instavel: 'INSTÁVEL', offline: 'OFFLINE', sem_sinal: 'SEM SINAL' };
  els.chip.className = `status-chip ${status}`; els.chip.textContent = labels[status];
  els.system.className = `system-state ${status === 'instavel' ? 'waiting' : status}`;
  els.system.querySelector('span').textContent = status === 'online' ? 'NTC001 transmitindo normalmente' : status === 'instavel' ? 'Sinal do NTC001 está instável' : status === 'offline' ? 'NTC001 sem comunicação há mais de 2 minutos' : 'Aguardando o primeiro sinal do NTC001';
  if (status === 'offline' && state.priorStatus !== 'offline') alertSound();
  state.priorStatus = status;
}

function placeMarker(item, fly = true) {
  if (!state.map?.loaded()) return;
  if (!state.marker) {
    const element = document.createElement('div'); element.className = 'equipment-marker'; element.setAttribute('aria-label', 'Posição atual do NTC001. Passe o mouse ou toque para ver o KM.'); element.tabIndex = 0;
    state.marker = new maplibregl.Marker({ element }).setLngLat([item.longitude, item.latitude]).addTo(state.map);
    state.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 24, className: 'equipment-popup' });
    element.addEventListener('mouseenter', () => showEquipmentPopup(state.latest));
    element.addEventListener('focus', () => showEquipmentPopup(state.latest));
    element.addEventListener('mouseleave', () => { if (!state.popupPinned) state.popup.remove(); });
    element.addEventListener('blur', () => { if (!state.popupPinned) state.popup.remove(); });
    element.addEventListener('click', () => { state.popupPinned = !state.popupPinned; state.popupPinned ? showEquipmentPopup(state.latest) : state.popup.remove(); });
  } else state.marker.setLngLat([item.longitude, item.latitude]);
  if (state.popup?.isOpen()) showEquipmentPopup(item);
  els.recenter.hidden = false;
  if (fly) state.map.easeTo({ center: [item.longitude, item.latitude], zoom: Math.max(state.map.getZoom(), 13), duration: 900 });
}

function showEquipmentPopup(item) {
  if (!item || !state.popup || !state.map) return;
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
  state.popup.setLngLat([item.longitude, item.latitude]).setDOMContent(content).addTo(state.map);
}

function render(item) {
  state.latest = item;
  const status = effectiveStatus(item); setStatus(status);
  if (!item?.receivedAt) return;
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
  placeMarker(item, !state.marker);
}

async function loadLatest() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/equipment/latest`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data.equipment.find((item) => item.equipmentId === 'NTC001'));
    if (!state.historyLoaded && state.latest?.receivedAt) loadHistory();
  } catch (error) {
    els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Serviço de rastreamento indisponível';
    console.warn('Falha ao consultar posição', error);
  }
}

async function loadHistory() {
  state.historyLoaded = true;
  try {
    const response = await fetch(`${API_BASE}/api/v1/equipment/NTC001/history?hours=24&limit=20000`);
    const data = await response.json();
    const positions = data.positions || [];
    if (state.map?.getSource('history')) state.map.getSource('history').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: positions.map((p) => [p.longitude, p.latitude]) } });
    els.history.textContent = positions.length ? `${positions.length.toLocaleString('pt-BR')} posições recebidas no período.` : 'Ainda não há percurso registrado nas últimas 24 horas.';
  } catch { els.history.textContent = 'Não foi possível carregar o percurso recente.'; }
}

els.sound.addEventListener('click', () => { state.sound = !state.sound; els.sound.setAttribute('aria-pressed', String(state.sound)); els.sound.lastChild.textContent = state.sound ? ' Som ativo' : ' Ativar som'; if (state.sound) alertSound(); });
els.recenter.addEventListener('click', () => state.latest && state.map.easeTo({ center: [state.latest.longitude, state.latest.latitude], zoom: 14, duration: 700 }));

fetch(AXIS_URL).then((response) => response.json()).then((data) => { state.axis = data.points; initMap(state.axis); loadLatest(); setInterval(loadLatest, 5000); setInterval(() => state.latest && render(state.latest), 1000); }).catch((error) => { els.system.className = 'system-state offline'; els.system.querySelector('span').textContent = 'Traçado ferroviário indisponível'; console.error(error); });
