import {
  GPS_DEADBAND_M,
  GPS_MAX_PRECISION_M,
  analyzeProjectedTrack,
} from "./motion.js";

const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://127.0.0.1:8791"
  : "https://fico-tracking-api.automacaofico.workers.dev";
const AXIS = "../../mapa-superestrutura/assets/data/fico-axis-full.json";
const $ = (id) => document.getElementById(id);
const els = {
  access: $("access"),
  accessForm: $("access-form"),
  password: $("password"),
  accessMessage: $("access-message"),
  dashboard: $("dashboard"),
  filters: $("filters"),
  equipment: $("equipment"),
  operator: $("operator"),
  from: $("from"),
  to: $("to"),
  message: $("message"),
  distance: $("distance"),
  moving: $("moving"),
  stopped: $("stopped"),
  average: $("average"),
  maximum: $("maximum"),
  coverage: $("coverage"),
  source: $("source"),
  chart: $("speed-chart"),
  sessions: $("sessions-body"),
  shiftCount: $("shift-count"),
};
let password = "",
  axis = [],
  grid = new Map(),
  map;
const isoLocal = (date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 16);
};
els.to.value = isoLocal(new Date());
els.from.value = isoLocal(new Date(Date.now() - 24 * 3600000));
function notify(element, text) {
  element.textContent = text;
  element.hidden = !text;
}
function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}
function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Em andamento";
}
function gridKey(lon, lat) {
  return `${Math.floor(lon / 0.02)}:${Math.floor(lat / 0.02)}`;
}
function prepareAxis(points) {
  axis = points;
  for (const point of points) {
    const key = gridKey(point.coordinate[0], point.coordinate[1]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(point);
  }
}
function distanceMeters(lon1, lat1, lon2, lat2) {
  const y = (lat2 - lat1) * 111320,
    x = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) * Math.PI) / 360);
  return Math.hypot(x, y);
}
function project(point) {
  const gx = Math.floor(Number(point.longitude) / 0.02),
    gy = Math.floor(Number(point.latitude) / 0.02);
  let best = null;
  for (let x = gx - 1; x <= gx + 1; x++)
    for (let y = gy - 1; y <= gy + 1; y++)
      for (const candidate of grid.get(`${x}:${y}`) || []) {
        const d = distanceMeters(
          Number(point.longitude),
          Number(point.latitude),
          candidate.coordinate[0],
          candidate.coordinate[1],
        );
        if (!best || d < best.distanceM)
          best = {
            stationM: candidate.station_m,
            distanceM: d,
            coordinate: candidate.coordinate,
          };
      }
  return best;
}
function calculate(points, sessions) {
  const sorted = [...points].sort(
    (a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at),
  );
  sorted.forEach((point) => {
    point.projection = project(point);
  });
  const grouped = Object.groupBy
    ? Object.groupBy(
        sorted,
        (point) => `${point.equipment_id}:${point.operator_registration}`,
      )
    : sorted.reduce(
        (groups, point) => (
          (groups[`${point.equipment_id}:${point.operator_registration}`] ||= []).push(
            point,
          ),
          groups
        ),
        {},
      );
  const analyses = Object.values(grouped).map((values) =>
    analyzeProjectedTrack(values),
  );
  const timeline = analyses
    .flatMap((analysis) => analysis.timeline)
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const movingSpeeds = timeline
    .map((point) => Number(point.effective_speed_mps))
    .filter((speed) => Number.isFinite(speed) && speed >= 0.5);
  const rail = analyses.reduce((sum, analysis) => sum + analysis.distanceM, 0);
  const moving = analyses.reduce((sum, analysis) => sum + analysis.movingS, 0);
  const stopped = analyses.reduce(
    (sum, analysis) => sum + analysis.stoppedS,
    0,
  );
  const observed = analyses.reduce((sum, analysis) => sum + analysis.observedS, 0);
  const duration = sessions.reduce(
    (sum, item) =>
      sum +
      Math.max(
        0,
        (Date.parse(item.ended_at || els.to.value) -
          Date.parse(item.started_at)) /
          1000,
      ),
    0,
  );
  return {
    sorted: timeline,
    tracks: analyses.map((analysis) => analysis.accepted),
    rail,
    moving,
    stopped,
    max: movingSpeeds.length ? Math.max(...movingSpeeds) : 0,
    average: movingSpeeds.length
      ? movingSpeeds.reduce((sum, speed) => sum + speed, 0) /
        movingSpeeds.length
      : 0,
    coverage: duration ? Math.min(100, (observed / duration) * 100) : 0,
    rejectedCount: analyses.reduce(
      (sum, analysis) => sum + analysis.rejectedCount,
      0,
    ),
    suppressedCount: analyses.reduce(
      (sum, analysis) => sum + analysis.suppressedCount,
      0,
    ),
  };
}
function renderKpis(metrics) {
  els.distance.textContent = `${(metrics.rail / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
  els.moving.textContent = formatDuration(metrics.moving);
  els.stopped.textContent = formatDuration(metrics.stopped);
  els.average.textContent = `${(metrics.average * 3.6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km/h`;
  els.maximum.textContent = `${(metrics.max * 3.6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km/h`;
  els.coverage.textContent = `${metrics.coverage.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}
function renderSessions(items) {
  els.sessions.replaceChildren();
  els.shiftCount.textContent = `${items.length} turno${items.length === 1 ? "" : "s"}`;
  if (!items.length) {
    const row = els.sessions.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.textContent = "Nenhum turno no período.";
    return;
  }
  items.forEach((item) => {
    const row = els.sessions.insertRow();
    [
      formatDate(item.started_at),
      formatDate(item.ended_at),
      `${item.operator_name} · ${item.operator_registration}`,
      item.equipment_id,
      item.ended_reason || "Em andamento",
      formatDuration(
        (Date.parse(item.ended_at || els.to.value) -
          Date.parse(item.started_at)) /
          1000,
      ),
    ].forEach((value) => {
      const cell = row.insertCell();
      cell.textContent = value;
    });
  });
}
function renderChart(points) {
  els.chart.replaceChildren();
  const ns = "http://www.w3.org/2000/svg",
    width = 900,
    height = 260,
    padding = 34;
  if (!points.length) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "450");
    text.setAttribute("y", "135");
    text.setAttribute("text-anchor", "middle");
    text.textContent = "Sem posições no período";
    els.chart.append(text);
    return;
  }
  const sampleStep = Math.max(1, Math.ceil(points.length / 700)),
    sample = points.filter((_, i) => i % sampleStep === 0),
    start = Date.parse(points[0].captured_at),
    end = Date.parse(points.at(-1).captured_at),
    max = Math.max(
      10,
      ...sample.map((p) => Number(p.effective_speed_mps || 0) * 3.6),
    );
  for (let i = 0; i < 5; i++) {
    const line = document.createElementNS(ns, "line");
    const y = padding + ((height - padding * 2) * i) / 4;
    line.setAttribute("x1", padding);
    line.setAttribute("x2", width - padding);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "#dce4e9");
    els.chart.append(line);
  }
  const path = document.createElementNS(ns, "path");
  const d = sample
    .map((p, i) => {
      const x =
          padding +
          ((width - padding * 2) * (Date.parse(p.captured_at) - start)) /
            Math.max(1, end - start),
        y =
          height -
          padding -
          (height - padding * 2) *
            ((Number(p.effective_speed_mps || 0) * 3.6) / max);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#2f7fc4");
  path.setAttribute("stroke-width", "3");
  els.chart.append(path);
}
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    center: [-50.3, -14.08],
    zoom: 7,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.on("load", () => {
    map.addSource("axis", {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: axis.map((p) => p.coordinate),
        },
      },
    });
    map.addLayer({
      id: "axis",
      type: "line",
      source: "axis",
      paint: { "line-color": "#082b4c", "line-width": 3 },
    });
    map.addSource("track", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "track",
      type: "line",
      source: "track",
      paint: { "line-color": "#f28b22", "line-width": 4, "line-opacity": 0.85 },
    });
  });
}
function renderMap(tracks) {
  if (!map?.getSource("track")) return;
  const features = tracks
    .filter((v) => v.length > 1)
    .map((values) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: values.map((p) => p.projection.coordinate),
      },
    }));
  map.getSource("track").setData({ type: "FeatureCollection", features });
  const accepted = tracks.flat();
  if (accepted.length) {
    const bounds = new maplibregl.LngLatBounds();
    accepted.forEach((point) => bounds.extend(point.projection.coordinate));
    map.fitBounds(bounds, { padding: 45, maxZoom: 14 });
  }
}
function populate(data) {
  if (els.equipment.options.length === 1)
    data.equipment.forEach((item) =>
      els.equipment.add(new Option(`${item.id} · ${item.name}`, item.id)),
    );
  if (els.operator.options.length === 1)
    data.operators.forEach((item) =>
      els.operator.add(
        new Option(`${item.name} · ${item.registration}`, item.registration),
      ),
    );
}
async function load() {
  notify(els.message, "");
  const button = els.filters.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(`${API}/api/v2/admin/operations/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminPassword: password,
        equipmentId: els.equipment.value || null,
        registration: els.operator.value || null,
        from: new Date(els.from.value).toISOString(),
        to: new Date(els.to.value).toISOString(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha na consulta.");
    populate(data);
    const metrics = calculate(data.positions, data.sessions);
    renderKpis(metrics);
    renderSessions(data.sessions);
    renderChart(metrics.sorted);
    renderMap(metrics.tracks);
    const sourceLabel = data.positions.some(
      (p) => Date.parse(p.captured_at) < Date.now() - 7 * 86400000,
    )
      ? "Sinais originais + amostra de 1 min"
      : "Sinais originais";
    els.source.textContent =
      `${sourceLabel} · filtro ${GPS_DEADBAND_M} m · ` +
      `precisão ≤ ${GPS_MAX_PRECISION_M} m · ` +
      `${metrics.suppressedCount.toLocaleString("pt-BR")} oscilações suprimidas`;
  } catch (error) {
    notify(els.message, error.message);
  } finally {
    button.disabled = false;
  }
}
els.accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  password = els.password.value;
  notify(els.accessMessage, "");
  try {
    if (!axis.length) {
      const data = await fetch(AXIS).then((r) => r.json());
      prepareAxis(data.points);
      initMap();
    }
    await load();
    els.access.hidden = true;
    els.dashboard.hidden = false;
    setTimeout(() => map.resize(), 0);
  } catch (error) {
    password = "";
    notify(els.accessMessage, error.message);
  }
});
els.filters.addEventListener("submit", (event) => {
  event.preventDefault();
  load();
});
