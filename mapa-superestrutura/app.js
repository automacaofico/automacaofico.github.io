(() => {
  'use strict';

  const PATHS = {
    axis: 'assets/data/fico-axis-full.json',
    replay: 'assets/data/replay-history.json',
    workbook: 'https://raw.githubusercontent.com/automacaofico/super/main/Modelo%20Acompanhamento%20Super%20-%20FINAL.xlsx'
  };

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

  const DEFINITIONS = [
    { id: 'release', name: 'Liberação de plataforma', excel: 'liberacao de plataforma', start: 0, plannedEnd: 104500, color: '#1a7a3a', segmented: true },
    { id: 'prelast', name: 'Pré-lastro em plataforma', excel: 'pre lastro', start: 71300, plannedEnd: 78400, color: '#005a8a' },
    { id: 'grade', name: 'Montagem de grade', excel: 'montagem de grade', start: 0, plannedEnd: 87337, color: '#1a5fa8' },
    { id: 'brita1', name: '1ª Descarga de brita', excel: '1a descarga de brita', start: 0, plannedEnd: 80253, color: '#b87800' },
    { id: 'socaria1', name: 'Socaria — 1º levante', excel: 'socaria 1o levante', start: 0, plannedEnd: 71300, color: '#c04a00' },
    { id: 'socaria2', name: 'Socaria — 2º levante', excel: 'socaria 2o levante', start: 0, plannedEnd: 71300, color: '#b02020' },
    { id: 'brita2', name: '2ª Descarga de brita', excel: '2a descarga de brita', start: 0, plannedEnd: 75776, color: '#8a5a00' },
    { id: 'socaria3', name: 'Socaria — 3º levante', excel: 'socaria 3o levante', start: 0, plannedEnd: 71300, color: '#6b3db5' },
    { id: 'socaria4', name: 'Socaria — 4º levante', excel: 'socaria 4o levante', start: 0, plannedEnd: 67283, color: '#1178a0' },
    { id: 'brita3', name: '3ª Descarga de brita', excel: '3a descarga de brita', start: 0, plannedEnd: 75776, color: '#665500' },
    { id: 'weld', name: 'Solda aluminotérmica', excel: 'solda aluminotermica', start: 0, plannedEnd: 52187, color: '#b55a00' },
    { id: 'relief', name: 'Alívio de tensão', excel: 'alivio de tensao', start: 0, plannedEnd: 52948, color: '#2a8a50' }
  ];

  const state = {
    axis: [],
    activities: [],
    cushion: { completed: [], pending: [] },
    date: null,
    map: null,
    mapReady: false,
    selectedId: 'grade',
    packageId: '',
    basemap: 'street',
    sourceMode: 'online',
    replay: { active: false, playing: false, progress: 0, speed: 1, history: null, frame: null, startedAt: 0, startedProgress: 0, lastMapUpdate: 0 }
  };

  const el = id => document.getElementById(id);
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ªº°]/g, match => match === 'ª' ? 'a' : 'o').replace(/[–—-]/g, ' ').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
  const number = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const km = metres => `${(Math.max(0, metres || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  const station = metres => `KM ${(Math.max(0, metres || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  const percent = value => `${Math.max(0, value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const sumLengths = intervals => intervals.reduce((total, item) => total + Math.max(0, item.end - item.start), 0);
  const lerp = (start, end, amount) => start + (end - start) * amount;

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && window.XLSX?.SSF) {
      const parts = XLSX.SSF.parse_date_code(value);
      if (parts) return new Date(parts.y, parts.m - 1, parts.d);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function findRow(rows, predicate, start = 0) {
    for (let index = start; index < rows.length; index += 1) {
      if (predicate(rows[index].map(norm), rows[index])) return index;
    }
    return -1;
  }

  function findColumn(normalizedRow, options) {
    return normalizedRow.findIndex(cell => options.some(option => cell === option || cell.includes(option)));
  }

  function parseIntervals(rows, titlePattern, stopPattern) {
    const titleIndex = findRow(rows, cells => cells.some(cell => cell.includes(titlePattern)));
    if (titleIndex < 0) return [];
    const headerIndex = findRow(rows, cells => cells.some(cell => cell.includes('trecho')) && cells.some(cell => cell.includes('inicio')) && cells.some(cell => cell.includes('fim')), titleIndex + 1);
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(norm);
    const startColumn = findColumn(headers, ['inicio']);
    const endColumn = findColumn(headers, ['fim']);
    const statusColumn = findColumn(headers, ['concluido', 'status']);
    const result = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const cells = rows[index].map(norm);
      if (stopPattern && cells.some(cell => cell.includes(stopPattern))) break;
      const start = number(rows[index][startColumn]);
      const end = number(rows[index][endColumn]);
      if (start === null || end === null || end <= start) {
        if (result.length && cells.filter(Boolean).length === 0) break;
        continue;
      }
      result.push({
        start,
        end,
        completed: statusColumn < 0 || ['c', 'sim', 'concluido', 'ok', 'x', '1', 'true'].some(value => cells[statusColumn] === value || cells[statusColumn]?.includes(value))
      });
    }
    return result;
  }

  function parseWorkbook(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames.find(name => norm(name) === 'entrada') || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });
    const dateRow = findRow(rows, cells => cells.some(cell => cell.startsWith('data do levantamento')));
    let dataDate = null;
    if (dateRow >= 0) {
      const raw = rows[dateRow].find((value, index) => index > 0 && value !== null && value !== '');
      dataDate = parseDate(raw);
    }

    const activityHeader = findRow(rows, cells => cells.some(cell => cell === 'atividade') && cells.some(cell => cell.includes('km real')));
    const actualByName = new Map();
    if (activityHeader >= 0) {
      const headers = rows[activityHeader].map(norm);
      const nameColumn = findColumn(headers, ['atividade']);
      const actualColumn = findColumn(headers, ['km real']);
      for (let index = activityHeader + 1; index < rows.length; index += 1) {
        const name = norm(rows[index][nameColumn]);
        if (!name || name.startsWith('3 liberacao')) break;
        const actual = number(rows[index][actualColumn]);
        if (actual !== null) actualByName.set(name, actual);
      }
    }

    const releaseIntervals = parseIntervals(rows, 'liberacao de plataforma', 'pre lastro em colchao').map(item => ({ ...item, completed: true }));
    const cushionIntervals = parseIntervals(rows, 'pre lastro em colchao', null);
    const activities = DEFINITIONS.map(definition => {
      let actualEnd = definition.start;
      let intervals = [];
      if (definition.segmented) {
        intervals = releaseIntervals;
        actualEnd = intervals.length ? Math.max(...intervals.map(item => item.end)) : definition.start;
      } else {
        for (const [key, value] of actualByName.entries()) {
          if (key === definition.excel || key.includes(definition.excel) || definition.excel.includes(key)) {
            actualEnd = value;
            break;
          }
        }
      }
      const actualLength = definition.segmented ? sumLengths(intervals) : Math.max(0, actualEnd - definition.start);
      const plannedLength = Math.max(1, definition.plannedEnd - definition.start);
      return { ...definition, actualEnd, actualLength, plannedLength, intervals, progress: actualLength / plannedLength * 100 };
    });

    return {
      date: dataDate,
      activities,
      cushion: {
        completed: cushionIntervals.filter(item => item.completed),
        pending: cushionIntervals.filter(item => !item.completed)
      }
    };
  }

  async function loadWorkbook(source = PATHS.workbook, mode = 'online') {
    setSource('loading');
    try {
      const buffer = source instanceof ArrayBuffer ? source : await fetch(source, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      });
      const parsed = parseWorkbook(buffer);
      state.date = parsed.date;
      state.activities = parsed.activities;
      state.cushion = parsed.cushion;
      state.sourceMode = mode;
      setSource(mode);
      renderAll();
      updateMapData();
      toast(mode === 'local' ? 'Excel local carregado' : 'Dados online atualizados');
    } catch (error) {
      console.error(error);
      setSource('error');
      el('sourceText').textContent = 'Falha ao acessar controle. Carregue arquivo Excel local.';
      toast('Controle indisponível');
    }
  }

  function setSource(mode) {
    const badge = el('sourceBadge');
    badge.className = `source-badge ${mode}`;
    if (mode === 'online') {
      badge.innerHTML = '<i></i> Sincronizado online';
      el('sourceText').textContent = 'Controle oficial hospedado no repositório da Superestrutura.';
    } else if (mode === 'local') {
      badge.innerHTML = '<i></i> Excel local';
      el('sourceText').textContent = 'Visualização temporária do arquivo selecionado.';
    } else if (mode === 'error') {
      badge.innerHTML = '<i></i> Base indisponível';
    } else {
      badge.innerHTML = '<i></i> Carregando';
    }
  }

  function packageAt(value) {
    return PACKAGES.find(item => value >= item.start && value < item.end) || PACKAGES[PACKAGES.length - 1];
  }

  function selectedActivity() {
    return state.activities.find(activity => activity.id === state.selectedId) || state.activities[0];
  }

  function renderAll() {
    renderMetrics();
    renderActivities();
    renderDetails();
    renderTable();
  }

  function renderMetrics() {
    const started = state.activities.filter(activity => activity.actualLength > 0).length;
    const release = state.activities.find(activity => activity.id === 'release');
    const leader = [...state.activities].sort((a, b) => b.actualEnd - a.actualEnd)[0];
    const completedCushion = sumLengths(state.cushion.completed);
    const allCushion = completedCushion + sumLengths(state.cushion.pending);
    el('metricDate').textContent = state.date ? state.date.toLocaleDateString('pt-BR') : '—';
    el('metricStarted').textContent = `${started}/${state.activities.length}`;
    el('metricRelease').textContent = release ? percent(release.progress) : '—';
    el('releaseCaption').textContent = release ? `${km(release.actualLength)} executados` : 'sobre previsto';
    el('metricLeader').textContent = leader ? station(leader.actualEnd) : '—';
    el('leaderCaption').textContent = leader?.name || 'atividade mais avançada';
    el('metricCushion').textContent = allCushion ? percent(completedCushion / allCushion * 100) : '—';
    el('cushionCaption').textContent = allCushion ? `${km(completedCushion)} concluídos` : 'trechos cadastrados';
  }

  function renderActivities() {
    el('activityCount').textContent = state.activities.length;
    el('activityList').innerHTML = state.activities.map(activity => `
      <button class="activity-card ${activity.id === state.selectedId ? 'active' : ''}" data-activity="${activity.id}" style="--activity-color:${activity.color}">
        <span class="name">${activity.name}</span>
        <span class="meta"><span>${station(activity.actualEnd)}</span><b>${percent(activity.progress)}</b></span>
        <span class="mini-progress"><i style="width:${Math.min(100, activity.progress)}%"></i></span>
      </button>`).join('');
    document.querySelectorAll('[data-activity]').forEach(button => button.addEventListener('click', () => selectActivity(button.dataset.activity)));
  }

  function renderDetails() {
    const activity = selectedActivity();
    if (!activity) return;
    const currentPackage = packageAt(activity.actualEnd);
    const delta = activity.actualEnd - activity.plannedEnd;
    el('detailName').textContent = activity.name;
    el('detailStatus').textContent = activity.actualLength > 0 ? 'Em execução' : 'Não iniciada';
    el('detailProgressBar').style.width = `${Math.min(100, activity.progress)}%`;
    el('detailProgressBar').style.background = activity.color;
    el('detailReal').textContent = km(activity.actualLength);
    el('detailPlanned').textContent = km(activity.plannedLength);
    el('detailPercent').textContent = percent(activity.progress);
    el('detailDelta').textContent = `${delta >= 0 ? '+' : '−'}${km(Math.abs(delta))}`;
    el('detailDelta').className = delta >= 0 ? 'delta-positive' : 'delta-negative';
    el('detailPackage').textContent = currentPackage.name;
    el('detailSection').textContent = `${station(currentPackage.start)} — ${station(currentPackage.end)}`;
    el('detailNote').textContent = activity.segmented ? `${activity.intervals.length} trecho(s) liberado(s), somados no avanço.` : `Frente registrada em ${station(activity.actualEnd)}.`;
  }

  function renderTable() {
    el('activityTableBody').innerHTML = state.activities.map(activity => {
      const delta = activity.actualEnd - activity.plannedEnd;
      return `<tr data-table-activity="${activity.id}" class="${activity.id === state.selectedId ? 'active' : ''}" style="--row-color:${activity.color}">
        <td><span class="table-activity"><i></i>${activity.name}</span></td>
        <td>${station(activity.start)}</td><td>${station(activity.actualEnd)}</td><td>${station(activity.plannedEnd)}</td>
        <td>${percent(activity.progress)}</td><td class="${delta >= 0 ? 'delta-positive' : 'delta-negative'}">${delta >= 0 ? '+' : '−'}${km(Math.abs(delta))}</td>
        <td>${packageAt(activity.actualEnd).name}</td></tr>`;
    }).join('');
    document.querySelectorAll('[data-table-activity]').forEach(row => row.addEventListener('click', () => selectActivity(row.dataset.tableActivity)));
  }

  function selectActivity(id) {
    state.selectedId = id;
    renderActivities();
    renderDetails();
    renderTable();
    updateMapData();
    updateReplayMap(true);
  }

  function pointAtStation(target) {
    if (!state.axis.length) return null;
    if (target <= state.axis[0].station_m) return state.axis[0].coordinate;
    if (target >= state.axis[state.axis.length - 1].station_m) return state.axis[state.axis.length - 1].coordinate;
    let low = 0;
    let high = state.axis.length - 1;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (state.axis[mid].station_m <= target) low = mid; else high = mid;
    }
    const before = state.axis[low];
    const after = state.axis[high];
    const ratio = (target - before.station_m) / Math.max(1, after.station_m - before.station_m);
    return [before.coordinate[0] + (after.coordinate[0] - before.coordinate[0]) * ratio, before.coordinate[1] + (after.coordinate[1] - before.coordinate[1]) * ratio];
  }

  function sliceCoordinates(start, end) {
    const coordinates = [pointAtStation(start)];
    state.axis.forEach(point => {
      if (point.station_m > start && point.station_m < end) coordinates.push(point.coordinate);
    });
    coordinates.push(pointAtStation(end));
    return coordinates.filter(Boolean);
  }

  function lineFeature(start, end, properties = {}) {
    return { type: 'Feature', properties: { start, end, ...properties }, geometry: { type: 'LineString', coordinates: sliceCoordinates(start, end) } };
  }

  function collection(features = []) {
    return { type: 'FeatureCollection', features };
  }

  async function initMap() {
    const [axisData, replayData] = await Promise.all([
      fetch(PATHS.axis).then(response => response.json()),
      fetch(PATHS.replay).then(response => response.json())
    ]);
    state.axis = Array.isArray(axisData) ? axisData : axisData.points;
    state.replay.history = replayData;
    const bounds = new maplibregl.LngLatBounds();
    state.axis.forEach(point => bounds.extend(point.coordinate));
    state.map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          street: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
          dark: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256, attribution: '© OpenStreetMap © CARTO' },
          satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Esri' }
        },
        layers: [
          { id: 'street', type: 'raster', source: 'street' },
          { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: document.documentElement.dataset.theme === 'dark' ? 'visible' : 'none' } },
          { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }
        ]
      },
      bounds,
      fitBoundsOptions: { padding: 48 },
      maxZoom: 17
    });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    state.map.on('load', () => {
      addOperationalLayers();
      state.mapReady = true;
      setBasemap(state.basemap);
      updateMapData();
      renderReplay();
      el('mapStatus').classList.add('hidden');
    });
    state.map.on('mousemove', event => updateCursorReadout(event.lngLat));
    state.map.on('mouseleave', () => {
      el('cursorPackage').textContent = state.packageId ? PACKAGES.find(item => item.id === state.packageId)?.name : 'Obra completa';
      el('cursorKm').textContent = 'Passe sobre traçado';
    });
  }

  function addOperationalLayers() {
    const packages = collection(PACKAGES.map(item => lineFeature(item.start, Math.min(item.end, state.axis[state.axis.length - 1].station_m), item)));
    state.map.addSource('packages', { type: 'geojson', data: packages });
    state.map.addLayer({ id: 'axis-casing', type: 'line', source: 'packages', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 5, 14, 11], 'line-opacity': .88 } });
    state.map.addLayer({ id: 'package-lines', type: 'line', source: 'packages', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 14, 6], 'line-opacity': .82 } });
    state.map.addSource('planned', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'planned-line', type: 'line', source: 'planned', paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': .48, 'line-dasharray': [1, 1.4] } });
    state.map.addSource('actual', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'actual-casing', type: 'line', source: 'actual', paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': .95 } });
    state.map.addLayer({ id: 'actual-line', type: 'line', source: 'actual', paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': 1 } });
    state.map.addSource('replay-lines', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'replay-casing', type: 'line', source: 'replay-lines', layout: { visibility: 'none' }, paint: { 'line-color': '#061e34', 'line-width': ['case', ['get', 'selected'], 10, 6], 'line-offset': ['get', 'offset'], 'line-opacity': .9 } });
    state.map.addLayer({ id: 'replay-lines', type: 'line', source: 'replay-lines', layout: { visibility: 'none' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 6, 3], 'line-offset': ['get', 'offset'], 'line-opacity': ['case', ['get', 'selected'], 1, .78] } });
    state.map.addSource('replay-fronts', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'replay-halo', type: 'circle', source: 'replay-fronts', layout: { visibility: 'none' }, paint: { 'circle-radius': ['case', ['get', 'selected'], 13, 8], 'circle-color': ['get', 'color'], 'circle-opacity': .18 } });
    state.map.addLayer({ id: 'replay-fronts', type: 'circle', source: 'replay-fronts', layout: { visibility: 'none' }, paint: { 'circle-radius': ['case', ['get', 'selected'], 7, 4], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    state.map.addLayer({ id: 'replay-fronts-hit', type: 'circle', source: 'replay-fronts', layout: { visibility: 'none' }, paint: { 'circle-radius': ['case', ['get', 'selected'], 18, 14], 'circle-color': '#ffffff', 'circle-opacity': .01 } });
    state.map.addSource('cushion', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'cushion-line', type: 'line', source: 'cushion', paint: { 'line-color': ['match', ['get', 'status'], 'Concluído', '#55a646', '#ee7623'], 'line-width': 4, 'line-offset': 7, 'line-opacity': .9 } });
    state.map.addSource('fronts', { type: 'geojson', data: collection() });
    state.map.addLayer({ id: 'fronts', type: 'circle', source: 'fronts', paint: { 'circle-radius': ['case', ['get', 'selected'], 8, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': ['case', ['get', 'selected'], 1, .76] } });
    state.map.addLayer({ id: 'fronts-hit', type: 'circle', source: 'fronts', paint: { 'circle-radius': ['case', ['get', 'selected'], 18, 14], 'circle-color': '#ffffff', 'circle-opacity': .01 } });
    state.map.addSource('boundaries', { type: 'geojson', data: collection(PACKAGES.slice(1).map(item => ({ type: 'Feature', properties: item, geometry: { type: 'Point', coordinates: pointAtStation(item.start) } }))) });
    state.map.addLayer({ id: 'boundaries', type: 'circle', source: 'boundaries', paint: { 'circle-radius': 3, 'circle-color': '#092844', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
    bindFrontInteractions('fronts-hit');
    bindFrontInteractions('replay-fronts-hit');
  }

  function frontTooltipHtml(properties) {
    const progressValue = Number(properties.progress) || 0;
    const stationValue = Number(properties.station) || 0;
    return `<div class="work-tooltip" style="--tooltip-color:${properties.color}">
      <div class="work-tooltip-head"><span><i></i>${properties.context || 'FRENTE ATUAL'}</span><b>${properties.package || packageAt(stationValue).name}</b></div>
      <strong>${properties.name}</strong>
      <div class="work-tooltip-grid">
        <div><span>Localização</span><b>${station(stationValue)}</b></div>
        <div><span>Avanço</span><b>${percent(progressValue)}</b></div>
      </div>
      <small>${properties.note || 'Passe sobre outras frentes para comparar.'}</small>
    </div>`;
  }

  function bindFrontInteractions(layerId) {
    const hoverPopup = new maplibregl.Popup({ offset: 16, closeButton: false, closeOnClick: false, className: 'work-popup' });
    state.map.on('mouseenter', layerId, event => {
      state.map.getCanvas().style.cursor = 'pointer';
      const feature = event.features?.[0];
      if (feature) hoverPopup.setLngLat(feature.geometry.coordinates).setHTML(frontTooltipHtml(feature.properties)).addTo(state.map);
    });
    state.map.on('mousemove', layerId, event => {
      const feature = event.features?.[0];
      if (feature) hoverPopup.setLngLat(feature.geometry.coordinates).setHTML(frontTooltipHtml(feature.properties));
    });
    state.map.on('mouseleave', layerId, () => {
      state.map.getCanvas().style.cursor = '';
      hoverPopup.remove();
    });
    state.map.on('click', layerId, event => {
      const feature = event.features?.[0];
      if (!feature) return;
      selectActivity(feature.properties.id);
      new maplibregl.Popup({ offset: 16, closeButton: true, className: 'work-popup pinned' }).setLngLat(feature.geometry.coordinates).setHTML(frontTooltipHtml(feature.properties)).addTo(state.map);
    });
  }

  function filteredIntervals(activity) {
    const packageFilter = PACKAGES.find(item => item.id === state.packageId);
    const ranges = activity.segmented ? activity.intervals : [{ start: activity.start, end: activity.actualEnd }];
    return ranges.map(range => ({ start: Math.max(range.start, packageFilter?.start ?? range.start), end: Math.min(range.end, packageFilter?.end ?? range.end) })).filter(range => range.end > range.start);
  }

  function updateMapData() {
    if (!state.mapReady || !state.activities.length) return;
    const activity = selectedActivity();
    const packageFilter = PACKAGES.find(item => item.id === state.packageId);
    const plannedStart = Math.max(activity.start, packageFilter?.start ?? activity.start);
    const plannedEnd = Math.min(activity.plannedEnd, packageFilter?.end ?? activity.plannedEnd);
    const planned = plannedEnd > plannedStart ? [lineFeature(plannedStart, plannedEnd, { color: activity.color })] : [];
    const actual = filteredIntervals(activity).map(range => lineFeature(range.start, range.end, { color: activity.color }));
    const cushion = [...state.cushion.completed.map(item => ({ ...item, status: 'Concluído' })), ...state.cushion.pending.map(item => ({ ...item, status: 'Pendente' }))]
      .map(item => ({ ...item, start: Math.max(item.start, packageFilter?.start ?? item.start), end: Math.min(item.end, packageFilter?.end ?? item.end) }))
      .filter(item => item.end > item.start)
      .map(item => lineFeature(item.start, item.end, { status: item.status }));
    const fronts = state.activities.filter(item => item.actualLength > 0).filter(item => !packageFilter || (item.actualEnd >= packageFilter.start && item.actualEnd <= packageFilter.end)).map(item => ({
      type: 'Feature', properties: { id: item.id, name: item.name, station: item.actualEnd, color: item.color, selected: item.id === state.selectedId, progress: item.progress, package: packageAt(item.actualEnd).name, context: 'FRENTE ATUAL', note: `Registro oficial em ${state.date ? state.date.toLocaleDateString('pt-BR') : 'data-base atual'}.` }, geometry: { type: 'Point', coordinates: pointAtStation(item.actualEnd) }
    }));
    state.map.getSource('planned').setData(collection(planned));
    state.map.getSource('actual').setData(collection(actual));
    state.map.getSource('cushion').setData(collection(cushion));
    state.map.getSource('fronts').setData(collection(fronts));
    const normalVisibility = state.replay.active ? 'none' : 'visible';
    state.map.setLayoutProperty('planned-line', 'visibility', !state.replay.active && el('showPlanned').checked ? 'visible' : 'none');
    ['fronts', 'fronts-hit'].forEach(layer => state.map.setLayoutProperty(layer, 'visibility', !state.replay.active && el('showFronts').checked ? 'visible' : 'none'));
    ['actual-casing', 'actual-line', 'cushion-line'].forEach(layer => state.map.setLayoutProperty(layer, 'visibility', normalVisibility));
  }

  function replayValues() {
    const snapshots = state.replay.history?.snapshots || [];
    if (snapshots.length < 2) return null;
    const start = snapshots[0];
    const end = snapshots[snapshots.length - 1];
    const progress = state.replay.progress;
    const values = {};
    DEFINITIONS.forEach(activity => {
      values[activity.id] = lerp(start.values[activity.id] ?? activity.start, end.values[activity.id] ?? activity.start, progress);
    });
    return { start, end, values };
  }

  function renderReplay() {
    const replay = replayValues();
    if (!replay) return;
    const currentDate = new Date(lerp(new Date(`${replay.start.date}T12:00:00`).getTime(), new Date(`${replay.end.date}T12:00:00`).getTime(), state.replay.progress));
    const production = DEFINITIONS.reduce((total, activity) => total + Math.max(0, replay.values[activity.id] - activity.start), 0);
    const gains = DEFINITIONS.map(activity => ({ activity, gain: ((replay.end.values[activity.id] ?? 0) - (replay.start.values[activity.id] ?? 0)) * state.replay.progress })).sort((a, b) => b.gain - a.gain);
    const phase = state.replay.progress < .015 || state.replay.progress > .985 ? 'BASE REAL' : 'INTERPOLAÇÃO VISUAL';
    el('replayPhase').textContent = phase;
    el('replayDate').textContent = currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '').toUpperCase();
    el('replayProduction').textContent = km(production);
    el('replayHighlight').textContent = state.replay.progress < .01 ? 'Ponto inicial' : `${gains[0].activity.name} · +${km(gains[0].gain)}`;
    el('replayRange').value = String(Math.round(state.replay.progress * 1000));
  }

  function updateReplayMap(force = false) {
    if (!state.mapReady || !state.replay.active) return;
    const now = performance.now();
    if (!force && now - state.replay.lastMapUpdate < 70) return;
    state.replay.lastMapUpdate = now;
    const replay = replayValues();
    if (!replay) return;
    const currentDate = new Date(lerp(new Date(`${replay.start.date}T12:00:00`).getTime(), new Date(`${replay.end.date}T12:00:00`).getTime(), state.replay.progress));
    const replayContext = state.replay.progress < .015 || state.replay.progress > .985 ? 'BASE REAL' : 'REPLAY INTERPOLADO';
    const features = [];
    const fronts = [];
    DEFINITIONS.forEach((activity, index) => {
      const end = replay.values[activity.id];
      if (end <= activity.start) return;
      const selected = activity.id === state.selectedId;
      const offset = (index - (DEFINITIONS.length - 1) / 2) * 2.35;
      features.push(lineFeature(activity.start, end, { id: activity.id, name: activity.name, color: activity.color, selected, offset }));
      fronts.push({ type: 'Feature', properties: { id: activity.id, name: activity.name, station: end, color: activity.color, selected, progress: Math.max(0, end - activity.start) / Math.max(1, activity.plannedEnd - activity.start) * 100, package: packageAt(end).name, context: replayContext, note: `Posição em ${currentDate.toLocaleDateString('pt-BR')}.` }, geometry: { type: 'Point', coordinates: pointAtStation(end) } });
    });
    state.map.getSource('replay-lines').setData(collection(features));
    state.map.getSource('replay-fronts').setData(collection(fronts));
  }

  function setReplayProgress(progress, force = false) {
    state.replay.progress = Math.max(0, Math.min(1, progress));
    renderReplay();
    updateReplayMap(force);
  }

  function setReplayLayers(active) {
    if (!state.mapReady) return;
    ['replay-casing', 'replay-lines', 'replay-halo', 'replay-fronts', 'replay-fronts-hit'].forEach(layer => state.map.setLayoutProperty(layer, 'visibility', active ? 'visible' : 'none'));
    state.map.setPaintProperty('package-lines', 'line-opacity', active ? .25 : .82);
    updateMapData();
  }

  function openReplay() {
    state.replay.active = true;
    document.body.classList.add('replay-active');
    el('replayDeck').classList.add('open');
    el('replayDeck').setAttribute('aria-hidden', 'false');
    el('replayButton').classList.add('active');
    el('replayButton').setAttribute('aria-expanded', 'true');
    setReplayLayers(true);
    setReplayProgress(state.replay.progress, true);
    el('replayDeck').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const bounds = new maplibregl.LngLatBounds();
    sliceCoordinates(0, 90000).forEach(coordinate => bounds.extend(coordinate));
    state.map?.fitBounds(bounds, { padding: window.innerWidth < 700 ? 34 : 64, duration: 850 });
  }

  function stopReplay() {
    state.replay.playing = false;
    cancelAnimationFrame(state.replay.frame);
    el('replayPlay').classList.remove('playing');
    el('replayPlay').setAttribute('aria-label', 'Reproduzir replay');
  }

  function closeReplay() {
    stopReplay();
    state.replay.active = false;
    document.body.classList.remove('replay-active');
    el('replayDeck').classList.remove('open');
    el('replayDeck').setAttribute('aria-hidden', 'true');
    el('replayButton').classList.remove('active');
    el('replayButton').setAttribute('aria-expanded', 'false');
    setReplayLayers(false);
    fitCurrent();
  }

  function replayTick(timestamp) {
    if (!state.replay.playing) return;
    const duration = 9000 / state.replay.speed;
    const next = state.replay.startedProgress + (timestamp - state.replay.startedAt) / duration;
    setReplayProgress(next);
    if (next >= 1) { stopReplay(); return; }
    state.replay.frame = requestAnimationFrame(replayTick);
  }

  function toggleReplayPlayback() {
    if (state.replay.playing) { stopReplay(); return; }
    if (state.replay.progress >= .999) setReplayProgress(0, true);
    state.replay.playing = true;
    state.replay.startedAt = performance.now();
    state.replay.startedProgress = state.replay.progress;
    el('replayPlay').classList.add('playing');
    el('replayPlay').setAttribute('aria-label', 'Pausar replay');
    state.replay.frame = requestAnimationFrame(replayTick);
  }

  function cycleReplaySpeed() {
    state.replay.speed = state.replay.speed === 1 ? 2 : state.replay.speed === 2 ? .5 : 1;
    el('replaySpeed').textContent = `Velocidade ${String(state.replay.speed).replace('.', ',')}×`;
    if (state.replay.playing) {
      state.replay.startedProgress = state.replay.progress;
      state.replay.startedAt = performance.now();
    }
  }

  function updateCursorReadout(lngLat) {
    if (!state.axis.length) return;
    let nearest = state.axis[0];
    let distance = Infinity;
    for (const point of state.axis) {
      const dx = point.coordinate[0] - lngLat.lng;
      const dy = point.coordinate[1] - lngLat.lat;
      const candidate = dx * dx + dy * dy;
      if (candidate < distance) { distance = candidate; nearest = point; }
    }
    el('cursorPackage').textContent = packageAt(nearest.station_m).name;
    el('cursorKm').textContent = station(nearest.station_m);
  }

  function fitCurrent() {
    if (!state.map || !state.axis.length) return;
    const range = PACKAGES.find(item => item.id === state.packageId) || { start: state.axis[0].station_m, end: state.axis[state.axis.length - 1].station_m };
    const bounds = new maplibregl.LngLatBounds();
    sliceCoordinates(range.start, Math.min(range.end, state.axis[state.axis.length - 1].station_m)).forEach(coordinate => bounds.extend(coordinate));
    state.map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 35 : 70, duration: 900 });
  }

  function zoomFront() {
    const activity = selectedActivity();
    if (!activity || !state.map) return;
    state.map.flyTo({ center: pointAtStation(activity.actualEnd), zoom: 13.3, duration: 1000 });
  }

  function setBasemap(name) {
    if (!state.mapReady) return;
    state.basemap = name;
    const darkTheme = document.documentElement.dataset.theme === 'dark';
    state.map.setLayoutProperty('street', 'visibility', name === 'street' && !darkTheme ? 'visible' : 'none');
    state.map.setLayoutProperty('dark', 'visibility', name === 'street' && darkTheme ? 'visible' : 'none');
    state.map.setLayoutProperty('satellite', 'visibility', name === 'satellite' ? 'visible' : 'none');
    document.querySelectorAll('[data-basemap]').forEach(button => {
      const active = button.dataset.basemap === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#061725' : '#0b2947');
    const toggle = el('themeToggle');
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
    toggle.title = theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro';
    if (persist) localStorage.setItem('fico-theme', theme);
    if (state.mapReady) setBasemap(state.basemap);
  }

  function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  let toastTimer;
  function toast(message) {
    const target = el('toast');
    target.textContent = message;
    target.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('show'), 2300);
  }

  function bindControls() {
    setTheme(document.documentElement.dataset.theme || 'light', false);
    PACKAGES.forEach(item => el('packageSelect').insertAdjacentHTML('beforeend', `<option value="${item.id}">${item.name} · ${station(item.start)}–${station(item.end)}</option>`));
    el('packageSelect').addEventListener('change', event => { state.packageId = event.target.value; updateMapData(); fitCurrent(); });
    document.querySelectorAll('[data-basemap]').forEach(button => button.addEventListener('click', () => setBasemap(button.dataset.basemap)));
    el('themeToggle').addEventListener('click', toggleTheme);
    el('showPlanned').addEventListener('change', updateMapData);
    el('showFronts').addEventListener('change', updateMapData);
    el('fitButton').addEventListener('click', fitCurrent);
    el('refreshButton').addEventListener('click', () => loadWorkbook());
    el('zoomFrontButton').addEventListener('click', zoomFront);
    el('replayButton').addEventListener('click', () => state.replay.active ? closeReplay() : openReplay());
    el('replayClose').addEventListener('click', closeReplay);
    el('replayPlay').addEventListener('click', toggleReplayPlayback);
    el('replaySpeed').addEventListener('click', cycleReplaySpeed);
    el('replayRange').addEventListener('input', event => { stopReplay(); setReplayProgress(Number(event.target.value) / 1000, true); });
    el('excelInput').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      await loadWorkbook(await file.arrayBuffer(), 'local');
      event.target.value = '';
    });
  }

  async function start() {
    bindControls();
    try {
      await Promise.all([initMap(), loadWorkbook()]);
    } catch (error) {
      console.error(error);
      el('mapStatus').textContent = 'Falha ao preparar mapa';
    }
  }

  start();
})();
