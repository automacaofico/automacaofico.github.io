(function () {
  "use strict";

  const PATHS = {
    tracks: "assets/data/fico-station-tracks.json",
    initialData: "assets/data/pendencias-iniciais.json",
    remoteWorkbook: "https://raw.githubusercontent.com/automacaofico/mapa-pendencias/main/Pendencias_FICO_Mapa.xlsx",
  };

  const COLORS = {
    open: "#f89b32",
    closed: "#1f7a4d",
    review: "#3578bc",
    rejected: "#b7403b",
    neutral: "#75879a",
  };

  const PACKAGE_COLORS = { "1": "#3578bc", "2": "#f89b32", "3": "#1f7a4d" };
  const state = {
    records: [],
    filtered: [],
    tracks: [],
    locations: new Map(),
    map: null,
    isMapReady: false,
    sourceName: "Base inicial",
    sourceDate: null,
    activeBasemap: "street",
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const numberFormat = new Intl.NumberFormat("pt-BR");
  const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

  const normalizeText = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const getField = (row, ...aliases) => {
    const entries = Object.entries(row ?? {});
    for (const alias of aliases) {
      const normalizedAlias = normalizeText(alias);
      const match = entries.find(([key]) => normalizeText(key) === normalizedAlias);
      if (match && match[1] !== undefined && match[1] !== null) return match[1];
    }
    return null;
  };

  const toIsoDate = (value) => {
    if (value === null || value === undefined || value === "") return "";
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    const brazilian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brazilian) return `${brazilian[3]}-${brazilian[2].padStart(2, "0")}-${brazilian[1].padStart(2, "0")}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10);
  };

  const normalizeRecord = (row, index) => ({
    id: getField(row, "ID ATLAS", "ID", "Código") ?? index + 1,
    originalId: getField(row, "ID original", "ID Origem"),
    company: String(getField(row, "Empresa", "Contratada") ?? "Não informada").trim(),
    package: String(getField(row, "Pacote") ?? "").trim(),
    section: String(getField(row, "Trecho", "Segmento") ?? "").trim(),
    asset: String(getField(row, "Ativo") ?? "Não informado").replace(/\s*\n\s*/g, " ").trim(),
    side: String(getField(row, "Lado") ?? "").trim(),
    specialty: String(getField(row, "Especialidade", "Disciplina") ?? "Não informada").trim(),
    classification: String(getField(row, "Classificação", "Classificacao", "Tipo") ?? "").trim(),
    description: String(getField(row, "Descrição", "Descricao", "Pendência", "Pendencia") ?? "Sem descrição").trim(),
    kmStart: getField(row, "KM inicial", "Km Inicial", "KM início", "KM inicio"),
    kmEnd: getField(row, "KM final", "Km Final", "KM fim"),
    status: String(getField(row, "Status", "Situação", "Situacao") ?? "Não informado").trim(),
    ficoOwner: String(getField(row, "Responsável FICO", "Responsavel FICO", "Fiscal") ?? "").trim(),
    contractorOwner: String(getField(row, "Responsável contratada", "Responsavel contratada") ?? "").trim(),
    openedAt: toIsoDate(getField(row, "Abertura", "Data de abertura")),
    deadline: toIsoDate(getField(row, "Prazo", "Data prazo")),
    expectedClose: toIsoDate(getField(row, "Previsão de baixa", "Previsao de baixa")),
    closedAt: toIsoDate(getField(row, "Baixa", "Data de baixa")),
    updatedAt: toIsoDate(getField(row, "Última atualização", "Ultima atualizacao")),
  });

  const isClosed = (status) => {
    const value = normalizeText(status);
    return value.includes("baixad") || value.includes("concluid") || value.includes("fechad");
  };

  const statusColor = (status) => {
    const value = normalizeText(status);
    if (isClosed(status)) return COLORS.closed;
    if (value.includes("rejeit")) return COLORS.rejected;
    if (value.includes("valid")) return COLORS.review;
    if (value.includes("trat")) return "#6fa1d8";
    if (value.includes("abert")) return COLORS.open;
    return COLORS.neutral;
  };

  const parseKm = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value).toUpperCase().replace(/^\s*KM\s*/, "").trim().replace(",", ".");
    const station = text.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
    if (station) return Number(station[1]) * 1000 + Number(station[2]);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return null;
    return numeric <= 250 ? numeric * 1000 : numeric;
  };

  const issueStation = (record) => {
    const values = [parseKm(record.kmStart), parseKm(record.kmEnd)].filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };

  const stationLabel = (stationMeters) => {
    if (!Number.isFinite(stationMeters)) return "Não informado";
    const km = Math.floor(stationMeters / 1000);
    const meters = Math.round(stationMeters - km * 1000);
    return `${km}+${String(meters).padStart(3, "0")}`;
  };

  const trackScore = (track, record, stationMeters) => {
    const lowerGap = Math.max(0, track.min_station_m - stationMeters);
    const upperGap = Math.max(0, stationMeters - track.max_station_m);
    let score = lowerGap + upperGap;
    const issueSection = normalizeText(record.section);
    const trackSection = normalizeText(track.section);
    if (issueSection && trackSection.includes(issueSection)) score -= 250;
    if (record.package && String(record.package) === String(track.package)) score -= 100;
    if (trackSection.includes("alca") && !issueSection.includes("alca")) score += 1000;
    return score;
  };

  const interpolateCoordinate = (track, stationMeters) => {
    const points = track.points;
    if (!points || points.length < 2) return null;
    let left = points[0];
    let right = points[1];
    let quality = "interpolated";

    if (stationMeters <= points[0].station_m) {
      quality = stationMeters < points[0].station_m ? "extrapolated" : "station";
    } else if (stationMeters >= points.at(-1).station_m) {
      left = points.at(-2);
      right = points.at(-1);
      quality = stationMeters > points.at(-1).station_m ? "extrapolated" : "station";
    } else {
      let low = 0;
      let high = points.length - 1;
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (points[middle].station_m <= stationMeters) low = middle;
        else high = middle;
      }
      left = points[low];
      right = points[high];
      if (left.station_m === stationMeters || right.station_m === stationMeters) quality = "station";
    }

    const span = right.station_m - left.station_m;
    const ratio = span ? (stationMeters - left.station_m) / span : 0;
    return {
      coordinate: [
        left.coordinate[0] + (right.coordinate[0] - left.coordinate[0]) * ratio,
        left.coordinate[1] + (right.coordinate[1] - left.coordinate[1]) * ratio,
      ],
      quality,
      track,
    };
  };

  const locateRecord = (record) => {
    const stationMeters = issueStation(record);
    if (!Number.isFinite(stationMeters)) return null;
    const candidates = state.tracks
      .filter((track) => stationMeters >= track.min_station_m - 500 && stationMeters <= track.max_station_m + 500)
      .sort((left, right) => trackScore(left, record, stationMeters) - trackScore(right, record, stationMeters));
    if (!candidates.length) return null;
    const result = interpolateCoordinate(candidates[0], stationMeters);
    return result ? { ...result, stationMeters } : null;
  };

  const railwayGeoJson = () => ({
    type: "FeatureCollection",
    features: state.tracks.map((track) => ({
      type: "Feature",
      properties: {
        id: track.id,
        package: track.package || "",
        section: track.section || "",
        color: PACKAGE_COLORS[String(track.package)] || COLORS.neutral,
        minKm: stationLabel(track.min_station_m),
        maxKm: stationLabel(track.max_station_m),
      },
      geometry: { type: "LineString", coordinates: track.points.map((point) => point.coordinate) },
    })),
  });

  const issueGeoJson = (records) => {
    const features = [];
    const quality = { located: 0, extrapolated: 0, unlocated: 0 };
    state.locations = new Map();
    records.forEach((record) => {
      const location = locateRecord(record);
      if (!location) {
        quality.unlocated += 1;
        return;
      }
      quality.located += 1;
      if (location.quality === "extrapolated") quality.extrapolated += 1;
      state.locations.set(String(record.id), location);
      features.push({
        type: "Feature",
        properties: {
          id: String(record.id),
          status: record.status,
          color: statusColor(record.status),
          company: record.company,
          specialty: record.specialty,
          asset: record.asset,
          station: stationLabel(location.stationMeters),
          kmRange: [record.kmStart, record.kmEnd].filter(Boolean).join(" → ") || "Não informado",
          section: record.section || location.track.section || "",
        },
        geometry: { type: "Point", coordinates: location.coordinate },
      });
    });
    return { geojson: { type: "FeatureCollection", features }, quality };
  };

  const mapStyle = () => ({
    version: 8,
    sources: {
      street: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      satellite: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Tiles © Esri",
      },
    },
    layers: [
      { id: "street-base", type: "raster", source: "street", layout: { visibility: "visible" } },
      { id: "satellite-base", type: "raster", source: "satellite", layout: { visibility: "none" } },
    ],
  });

  const addMapLayers = () => {
    const map = state.map;
    map.addSource("railway", { type: "geojson", data: railwayGeoJson() });
    map.addLayer({
      id: "railway-shadow",
      type: "line",
      source: "railway",
      paint: { "line-color": "#10203a", "line-width": 7, "line-opacity": .72 },
    });
    map.addLayer({
      id: "railway-line",
      type: "line",
      source: "railway",
      paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 1 },
    });
    map.addSource("issues", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 15,
      clusterRadius: 45,
    });
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "issues",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#6fa1d8", 20, "#3578bc", 100, "#18324d"],
        "circle-radius": ["step", ["get", "point_count"], 17, 20, 22, 100, 28],
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "issues",
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "issue-points",
      type: "circle",
      source: "issues",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 5, 15, 8],
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.on("click", "clusters", async (event) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: ["clusters"] })[0];
      if (!feature) return;
      const zoom = await map.getSource("issues").getClusterExpansionZoom(feature.properties.cluster_id);
      map.easeTo({ center: feature.geometry.coordinates, zoom });
    });

    map.on("click", "issue-points", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const record = state.filtered.find((item) => String(item.id) === String(feature.properties.id));
      const popup = new maplibregl.Popup({ offset: 12 })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`<article class="issue-popup">
          <p>KM ${escapeHtml(feature.properties.station)} · ${escapeHtml(feature.properties.section)}</p>
          <h3>#${escapeHtml(feature.properties.id)} · ${escapeHtml(feature.properties.asset)}</h3>
          <span>${escapeHtml(feature.properties.company)} · ${escapeHtml(feature.properties.specialty)}</span>
          <strong>${escapeHtml(feature.properties.status)}</strong>
          <small>${escapeHtml(feature.properties.kmRange)}</small>
          <button type="button" data-open-record="${escapeHtml(feature.properties.id)}">Ver detalhes</button>
        </article>`)
        .addTo(map);
      popup.on("open", () => {
        const button = popup.getElement()?.querySelector("[data-open-record]");
        if (button && record) button.onclick = () => openDetails(record);
      });
    });

    map.on("click", "railway-line", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new maplibregl.Popup({ offset: 8 })
        .setLngLat(event.lngLat)
        .setHTML(`<div class="rail-popup"><strong>Pacote ${escapeHtml(feature.properties.package)}</strong><span>Trecho ${escapeHtml(feature.properties.section)}</span><small>KM ${escapeHtml(feature.properties.minKm)} — ${escapeHtml(feature.properties.maxKm)}</small></div>`)
        .addTo(map);
    });

    ["clusters", "issue-points", "railway-line"].forEach((layer) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });
  };

  const fitRailway = () => {
    if (!state.map || !state.tracks.length) return;
    const bounds = new maplibregl.LngLatBounds();
    state.tracks.forEach((track) => track.points.forEach((point) => bounds.extend(point.coordinate)));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: 52, duration: 650, maxZoom: 13 });
  };

  const setBasemap = (mode) => {
    state.activeBasemap = mode;
    if (state.isMapReady) {
      state.map.setLayoutProperty("street-base", "visibility", mode === "street" ? "visible" : "none");
      state.map.setLayoutProperty("satellite-base", "visibility", mode === "satellite" ? "visible" : "none");
    }
    $$('[data-basemap]').forEach((button) => {
      const isActive = button.dataset.basemap === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const initializeMap = () => {
    state.map = new maplibregl.Map({
      container: "map",
      style: mapStyle(),
      center: [-49.17, -14.36],
      zoom: 8,
      maxZoom: 19,
      attributionControl: false,
    });
    state.map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    state.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    state.map.on("load", () => {
      state.isMapReady = true;
      addMapLayers();
      setBasemap(state.activeBasemap);
      updateDashboard();
      fitRailway();
      $("#loadingMap").classList.add("hidden");
    });
    state.map.on("error", (event) => {
      if (!event?.error?.message?.includes("tile")) console.error(event.error);
    });
  };

  const distinct = (field) => [...new Set(state.records.map((record) => record[field]).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right), "pt-BR", { numeric: true }));

  const setOptions = (selector, values, emptyLabel) => {
    const select = $(selector);
    const previous = select.value;
    select.innerHTML = `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (values.includes(previous)) select.value = previous;
  };

  const populateFilters = () => {
    setOptions("#companyFilter", distinct("company"), "Todas");
    setOptions("#sectionFilter", distinct("section"), "Todos");
    setOptions("#statusFilter", distinct("status"), "Todos");
    setOptions("#specialtyFilter", distinct("specialty"), "Todas");
  };

  const filterRecords = () => {
    const query = normalizeText($("#searchInput").value);
    const company = $("#companyFilter").value;
    const section = $("#sectionFilter").value;
    const status = $("#statusFilter").value;
    const specialty = $("#specialtyFilter").value;
    state.filtered = state.records.filter((record) => {
      const searchable = normalizeText([record.id, record.company, record.asset, record.description, record.specialty, record.ficoOwner].join(" "));
      return (!query || searchable.includes(query))
        && (!company || record.company === company)
        && (!section || record.section === section)
        && (!status || record.status === status)
        && (!specialty || record.specialty === specialty);
    });
    updateDashboard();
  };

  const updateMetrics = (quality) => {
    const open = state.filtered.filter((record) => !isClosed(record.status)).length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = state.filtered.filter((record) => !isClosed(record.status) && record.deadline && new Date(`${record.deadline}T00:00:00`) < today).length;
    $("#metricTotal").textContent = numberFormat.format(state.filtered.length);
    $("#metricLocated").textContent = numberFormat.format(quality.located);
    $("#metricOpen").textContent = numberFormat.format(open);
    $("#metricOverdue").textContent = numberFormat.format(overdue);
    const coverage = state.filtered.length ? Math.round(quality.located / state.filtered.length * 100) : 0;
    $("#coverageText").textContent = `${coverage}% sobre traçado`;
    const notice = $("#mapNotice");
    if (quality.unlocated || quality.extrapolated) {
      notice.textContent = `${quality.unlocated} registro(s) sem localização. ${quality.extrapolated} usam extrapolação máxima de 500 m.`;
      notice.classList.remove("hidden");
    } else {
      notice.classList.add("hidden");
    }
  };

  const updateBreakdown = () => {
    const counts = new Map();
    state.filtered.forEach((record) => counts.set(record.status, (counts.get(record.status) || 0) + 1));
    const rows = [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
    const maximum = Math.max(1, ...rows.map(([, count]) => count));
    $("#statusBreakdown").innerHTML = rows.length ? rows.map(([status, count]) => `<div class="breakdown-row"><span title="${escapeHtml(status)}">${escapeHtml(status)}</span><div class="breakdown-track"><i style="width:${Math.round(count / maximum * 100)}%;background:${statusColor(status)}"></i></div><strong>${numberFormat.format(count)}</strong></div>`).join("") : '<span class="empty-results">Sem dados.</span>';
  };

  const formatDate = (iso) => {
    if (!iso) return "Não informado";
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(date.valueOf()) ? iso : dateFormat.format(date);
  };

  const recordKm = (record) => [record.kmStart, record.kmEnd].filter((value) => value !== null && value !== undefined && value !== "").join(" → ") || "KM não informado";

  const updateList = () => {
    $("#resultCount").textContent = numberFormat.format(state.filtered.length);
    const visible = [...state.filtered]
      .sort((left, right) => Number(isClosed(left.status)) - Number(isClosed(right.status)) || Number(left.id) - Number(right.id))
      .slice(0, 250);
    $("#resultsList").innerHTML = visible.length ? visible.map((record) => `<button type="button" class="result-card ${isClosed(record.status) ? "closed" : ""}" data-record-id="${escapeHtml(record.id)}">
      <span class="status-line"></span>
      <span>
        <span class="result-top"><strong>#${escapeHtml(record.id)} · ${escapeHtml(record.company)}</strong><i class="status-pill ${isClosed(record.status) ? "closed" : ""}">${escapeHtml(record.status)}</i></span>
        <h4>${escapeHtml(record.asset)} · ${escapeHtml(record.specialty)}</h4>
        <p>${escapeHtml(recordKm(record))} · Trecho ${escapeHtml(record.section || "—")}</p>
      </span>
    </button>`).join("") : '<div class="empty-results">Nenhuma pendência encontrada.</div>';
    $$('[data-record-id]').forEach((button) => {
      button.onclick = () => {
        const record = state.filtered.find((item) => String(item.id) === button.dataset.recordId);
        if (!record) return;
        const location = state.locations.get(String(record.id));
        if (location && state.map) state.map.flyTo({ center: location.coordinate, zoom: 15, duration: 650 });
        openDetails(record);
      };
    });
  };

  const updateDashboard = () => {
    updateList();
    updateBreakdown();
    const { geojson, quality } = issueGeoJson(state.filtered);
    updateMetrics(quality);
    if (state.isMapReady) state.map.getSource("issues").setData(geojson);
  };

  const detailItem = (label, value) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "Não informado")}</strong></div>`;

  const openDetails = (record) => {
    $("#detailTitle").textContent = `#${record.id} · ${record.asset}`;
    $("#detailBody").innerHTML = `
      <span class="detail-status ${isClosed(record.status) ? "closed" : ""}">${escapeHtml(record.status)}</span>
      <p class="detail-description">${escapeHtml(record.description)}</p>
      <div class="detail-grid">
        ${detailItem("Empresa", record.company)}
        ${detailItem("Pacote / trecho", [record.package, record.section].filter(Boolean).join(" · "))}
        ${detailItem("KM", recordKm(record))}
        ${detailItem("Ativo / lado", [record.asset, record.side].filter(Boolean).join(" · "))}
        ${detailItem("Especialidade", record.specialty)}
        ${detailItem("Classificação", record.classification)}
        ${detailItem("Responsável FICO", record.ficoOwner)}
        ${detailItem("Responsável contratada", record.contractorOwner)}
        ${detailItem("Abertura", formatDate(record.openedAt))}
        ${detailItem("Prazo", formatDate(record.deadline))}
        ${detailItem("Previsão de baixa", formatDate(record.expectedClose))}
        ${detailItem("Baixa", formatDate(record.closedAt))}
      </div>`;
    $("#drawerOverlay").classList.remove("hidden");
    $("#detailDrawer").classList.add("open");
    $("#detailDrawer").setAttribute("aria-hidden", "false");
    $("#closeDrawer").focus();
  };

  const closeDetails = () => {
    $("#drawerOverlay").classList.add("hidden");
    $("#detailDrawer").classList.remove("open");
    $("#detailDrawer").setAttribute("aria-hidden", "true");
  };

  let toastTimer;
  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
  };

  const findDataSheet = (workbook) => {
    const named = workbook.SheetNames.find((name) => normalizeText(name).includes("pendencia"));
    if (named) return workbook.Sheets[named];
    return workbook.Sheets[workbook.SheetNames[0]];
  };

  const rowsFromSheet = (sheet) => {
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerIndex = matrix.slice(0, 15).findIndex((row) => {
      const keys = row.map(normalizeText);
      return keys.includes("empresa") && keys.includes("status") && keys.some((key) => key === "km inicial" || key === "km inicio");
    });
    if (headerIndex < 0) throw new Error("Cabeçalho esperado não encontrado.");
    const headers = matrix[headerIndex].map((value, index) => String(value ?? `Coluna ${index + 1}`).trim());
    return matrix.slice(headerIndex + 1)
      .filter((row) => row.some((value) => value !== null && value !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  };

  const recordsFromWorkbook = (workbook) => rowsFromSheet(findDataSheet(workbook))
    .map(normalizeRecord)
    .filter((record) => record.id !== null && record.id !== "");

  const recordsFromArrayBuffer = (arrayBuffer) => {
    if (!globalThis.XLSX) throw new Error("Leitor Excel indisponível.");
    return recordsFromWorkbook(XLSX.read(arrayBuffer, { cellDates: true }));
  };

  const loadWorkbook = async (file) => {
    const records = recordsFromArrayBuffer(await file.arrayBuffer());
    if (!records.length) throw new Error("Planilha não contém pendências.");
    state.records = records;
    state.filtered = records;
    state.sourceName = file.name;
    state.sourceDate = new Date(file.lastModified || Date.now());
    populateFilters();
    updateSourceLabel("uploaded");
    updateDashboard();
    fitRailway();
    showToast(`${numberFormat.format(records.length)} pendências carregadas.`);
  };

  const updateSourceLabel = (mode) => {
    const date = state.sourceDate
      ? dateFormat.format(state.sourceDate)
      : mode === "online" ? "atualização online" : "snapshot fornecido";
    const labels = {
      online: "Sincronizado online",
      uploaded: "Excel carregado",
      fallback: "Base contingência",
    };
    $("#sourceText").textContent = `${state.sourceName} · ${numberFormat.format(state.records.length)} registros · ${date}`;
    $("#sourceBadge").classList.toggle("loaded", mode !== "fallback");
    $("#sourceBadge").innerHTML = `<i></i>${labels[mode] || labels.fallback}`;
  };

  const loadInitialData = async () => {
    const trackResponse = await fetch(PATHS.tracks, { cache: "no-cache" });
    if (!trackResponse.ok) throw new Error("Traçado ferroviário indisponível.");
    const trackPayload = await trackResponse.json();
    state.tracks = (trackPayload.tracks || []).map((track) => ({
      ...track,
      points: [...track.points].sort((left, right) => left.station_m - right.station_m),
    }));

    try {
      const remoteResponse = await fetch(`${PATHS.remoteWorkbook}?_ts=${Date.now()}`, { cache: "no-store" });
      if (!remoteResponse.ok) throw new Error(`HTTP ${remoteResponse.status}`);
      state.records = recordsFromArrayBuffer(await remoteResponse.arrayBuffer());
      if (!state.records.length) throw new Error("Planilha online sem pendências.");
      state.sourceName = "Pendencias_FICO_Mapa.xlsx";
      state.sourceDate = null;
      updateSourceLabel("online");
    } catch (remoteError) {
      console.warn("Base online indisponível; usando contingência.", remoteError);
      const dataResponse = await fetch(PATHS.initialData, { cache: "no-cache" });
      if (!dataResponse.ok) throw new Error("Base de contingência indisponível.");
      const dataPayload = await dataResponse.json();
      state.records = (dataPayload.records || []).map(normalizeRecord);
      state.sourceName = "Base contingência";
      state.sourceDate = new Date("2026-07-13T00:00:00");
      updateSourceLabel("fallback");
      showToast("Base online indisponível.");
    }

    state.filtered = state.records;
    populateFilters();
    initializeMap();
  };

  const bindEvents = () => {
    $("#excelInput").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      showToast("Lendo planilha...");
      try {
        await loadWorkbook(file);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Falha ao ler planilha.");
      } finally {
        event.target.value = "";
      }
    });
    ["#companyFilter", "#sectionFilter", "#statusFilter", "#specialtyFilter"].forEach((selector) => $(selector).addEventListener("change", filterRecords));
    $("#searchInput").addEventListener("input", filterRecords);
    $("#clearFilters").addEventListener("click", () => {
      $("#searchInput").value = "";
      ["#companyFilter", "#sectionFilter", "#statusFilter", "#specialtyFilter"].forEach((selector) => { $(selector).value = ""; });
      filterRecords();
    });
    $$('[data-basemap]').forEach((button) => button.addEventListener("click", () => setBasemap(button.dataset.basemap)));
    $("#fitButton").addEventListener("click", fitRailway);
    $("#closeDrawer").addEventListener("click", closeDetails);
    $("#drawerOverlay").addEventListener("click", closeDetails);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetails(); });
  };

  const start = async () => {
    bindEvents();
    try {
      await loadInitialData();
    } catch (error) {
      console.error(error);
      $("#loadingMap").innerHTML = `<p>${escapeHtml(error.message || "Falha ao iniciar.")}</p>`;
      showToast("Falha ao abrir base inicial.");
    }
  };

  start();
})();
