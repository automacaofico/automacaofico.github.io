(() => {
  'use strict';

  const API_URL = window.FICO_VERSIONING_API || localStorage.getItem('fico_versioning_api') || 'https://fico-versioning-api.automacaofico.workers.dev';
  const PAGE_SIZE = 25;
  const state = { token: sessionStorage.getItem('fico_versioning_token') || '', user: sessionStorage.getItem('fico_versioning_user') || '', dashboards: [], dashboard: '', versions: [], comparison: null, rows: [], filtered: [], page: 1, restoreId: null };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '—').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const formatDate = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const shortId = (value) => value ? value.slice(0, 8).toUpperCase() : '—';

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    const response = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({ ok: false, error: 'Resposta inválida do servidor.' }));
    if (!response.ok) {
      if (response.status === 401) logout(false);
      const error = new Error(data.error || `Falha HTTP ${response.status}`);
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function showState(title, text, icon = '—') {
    $('#statePanel').hidden = false;
    $('#appContent').hidden = true;
    $('#stateTitle').textContent = title;
    $('#stateText').textContent = text;
    $('#stateIcon').textContent = icon;
  }

  function showApp() {
    $('#statePanel').hidden = true;
    $('#appContent').hidden = false;
    $('#loginPanel').hidden = true;
    $('#syncState').classList.add('online');
    $('#syncState').innerHTML = '<i></i> dados atualizados';
  }

  function logout(showLogin = true) {
    state.token = '';
    sessionStorage.removeItem('fico_versioning_token');
    if (showLogin) $('#loginPanel').hidden = false;
    $('#appContent').hidden = true;
    $('#syncState').classList.remove('online');
    $('#syncState').innerHTML = '<i></i> sessão encerrada';
  }

  async function login(event) {
    event.preventDefault();
    $('#loginError').textContent = '';
    const button = event.submitter;
    button.disabled = true;
    try {
      const user = $('#userName').value.trim() || 'operador';
      const data = await api('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password: $('#password').value })
      });
      state.token = data.token;
      state.user = user;
      sessionStorage.setItem('fico_versioning_token', data.token);
      sessionStorage.setItem('fico_versioning_user', user);
      await bootAuthenticated();
    } catch (error) {
      $('#loginError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function fillSelect(select, items, selected, label) {
    select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(label(item))}</option>`).join('');
  }

  async function loadDashboards() {
    const data = await api('/api/v1/dashboards');
    state.dashboards = data.dashboards;
    state.dashboard = state.dashboard || data.dashboards[0]?.id || '';
    fillSelect($('#dashboardSelect'), state.dashboards, state.dashboard, (item) => item.label);
  }

  async function loadVersions() {
    const data = await api(`/api/v1/dashboards/${encodeURIComponent(state.dashboard)}/versions`);
    state.versions = data.versions || [];
    if (!state.versions.length) {
      showState('Primeira versão pendente', 'Envie a primeira planilha pela página Atualizar Dashboard.', '01');
      return false;
    }
    const current = state.versions.find((version) => version.id === data.currentVersion) || state.versions[0];
    const previous = state.versions.find((version) => version.id === current.previousVersion) || state.versions[1] || current;
    fillSelect($('#fromVersion'), state.versions, previous.id, (item) => `${formatDate(item.uploadedAt)} · ${shortId(item.id)}`);
    fillSelect($('#toVersion'), state.versions, current.id, (item) => `${formatDate(item.uploadedAt)} · ${shortId(item.id)}`);
    renderTimeline(data.currentVersion);
    renderTrend();
    return true;
  }

  async function compareSelected() {
    const from = $('#fromVersion').value;
    const to = $('#toVersion').value;
    showState('Comparando versões', 'Normalizando e relacionando registros.', '↻');
    try {
      const data = from === to
        ? { comparison: { dashboard: state.dashboard, previousVersion: from, currentVersion: to, comparedAt: new Date().toISOString(), summary: { totalChanges: 0, added: 0, removed: 0, changed: 0, unchanged: 0, statusChanges: 0, increases: 0, reductions: 0, administrativeCorrections: 0, possibleDuplicates: 0 }, changes: [] } }
        : await api(`/api/v1/dashboards/${encodeURIComponent(state.dashboard)}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      state.comparison = data.comparison;
      renderComparison();
      showApp();
    } catch (error) {
      showState('Erro de carregamento', error.message, '!');
    }
  }

  function metricCard(label, value, note, tone = '') {
    return `<article class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
  }

  function flattenChanges() {
    const rows = [];
    for (const change of state.comparison?.changes || []) {
      const context = change.current || change.previous || {};
      if (!change.fields?.length) {
        rows.push({ sheet: change.sheet, key: change.key, field: 'Registro', previous: change.previous ? 'Existente' : '—', current: change.current ? 'Existente' : '—', variation: null, classification: change.type, context });
        continue;
      }
      change.fields.forEach((field) => rows.push({ sheet: change.sheet, key: change.key, field: field.field, previous: field.previous, current: field.current, variation: field.variation, classification: field.classification, context }));
    }
    state.rows = rows;
  }

  function topNumeric(classification, limit = 4) {
    return state.rows.filter((row) => row.classification === classification && Number.isFinite(row.variation)).sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation)).slice(0, limit);
  }

  function listRows(target, rows, emptyText) {
    target.innerHTML = rows.length
      ? rows.map((row) => `<li><b>${escapeHtml(row.field)}</b> · ${escapeHtml(row.sheet)}<br>${formatNumber(row.variation, 2)}</li>`).join('')
      : `<li>${escapeHtml(emptyText)}</li>`;
  }

  function summaryText(summary) {
    if (!summary.totalChanges) return 'Nenhuma alteração foi detectada entre as versões selecionadas. A base permanece estável.';
    const parts = [`Foram detectadas ${formatNumber(summary.totalChanges)} alterações`];
    if (summary.changed) parts.push(`${formatNumber(summary.changed)} registros mudaram`);
    if (summary.added) parts.push(`${formatNumber(summary.added)} registros entraram`);
    if (summary.removed) parts.push(`${formatNumber(summary.removed)} registros saíram`);
    if (summary.statusChanges) parts.push(`${formatNumber(summary.statusChanges)} mudanças de status exigem atenção`);
    return `${parts.join(', ')}. O detalhamento abaixo separa evolução física, redução e correções administrativas.`;
  }

  function renderComparison() {
    const summary = state.comparison.summary;
    const current = state.versions.find((version) => version.id === state.comparison.currentVersion);
    const previous = state.versions.find((version) => version.id === state.comparison.previousVersion);
    $('#currentVersionLabel').textContent = `#${shortId(current?.id)}`;
    $('#currentVersionDate').textContent = formatDate(current?.uploadedAt);
    $('#previousVersionLabel').textContent = `#${shortId(previous?.id)}`;
    $('#previousVersionDate').textContent = formatDate(previous?.uploadedAt);
    $('#metricCards').innerHTML = [
      metricCard('Alterações detectadas', formatNumber(summary.totalChanges), 'diferenças estruturadas', 'orange'),
      metricCard('Registros alterados', formatNumber(summary.changed), 'mesma chave, novos valores'),
      metricCard('Novos registros', formatNumber(summary.added), 'entradas nesta versão', 'green'),
      metricCard('Registros removidos', formatNumber(summary.removed), 'saídas desta versão', 'red'),
      metricCard('Mudanças de status', formatNumber(summary.statusChanges), 'transições operacionais', 'amber'),
      metricCard('Sem alteração', formatNumber(summary.unchanged), 'registros estáveis')
    ].join('');
    $('#executiveSummary').textContent = summaryText(summary);
    flattenChanges();
    listRows($('#topIncreases'), topNumeric('aumento'), 'Nenhum aumento relevante.');
    listRows($('#topReductions'), topNumeric('reducao'), 'Nenhuma redução relevante.');
    listRows($('#statusChanges'), state.rows.filter((row) => row.classification === 'mudanca_status').slice(0, 4), 'Nenhuma mudança de status.');
    const denominator = summary.changed + summary.unchanged + summary.added + summary.removed;
    const score = denominator ? Math.min(100, Math.round((summary.changed + summary.added + summary.removed) / denominator * 100)) : 0;
    $('#movementScore').textContent = score;
    $('#movementBar').style.width = `${score}%`;
    $('#movementText').textContent = score > 35 ? 'Movimentação alta. Revisão executiva recomendada.' : score > 10 ? 'Movimentação moderada entre versões.' : 'Base estável nesta comparação.';
    renderLocations();
    setupFilters();
    applyFilters();
  }

  function dimension(row, pattern) {
    const entries = Object.entries(row.context || {});
    const found = entries.find(([key]) => pattern.test(key));
    if (found?.[1] !== null && found?.[1] !== undefined && found[1] !== '') return String(found[1]);
    if (pattern.test(row.field)) return String(row.current ?? row.previous ?? '');
    return '';
  }

  function uniqueDimension(pattern) {
    return [...new Set(state.rows.map((row) => dimension(row, pattern)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }

  function setOptions(selector, values, placeholder) {
    const current = $(selector).value;
    $(selector).innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    if (values.includes(current)) $(selector).value = current;
  }

  function setupFilters() {
    setOptions('#sheetFilter', [...new Set(state.rows.map((row) => row.sheet))].sort(), 'Todas as abas');
    setOptions('#regionalFilter', uniqueDimension(/regional/i), 'Todas as regionais');
    setOptions('#packageFilter', uniqueDimension(/pacote/i), 'Todos os pacotes');
    setOptions('#activityFilter', uniqueDimension(/atividade|servi[cç]o/i), 'Todas as atividades');
    setOptions('#equipmentFilter', uniqueDimension(/equipamento|ativo/i), 'Todos os equipamentos');
    setOptions('#disciplineFilter', uniqueDimension(/disciplina|especialidade|tipo de pend/i), 'Todas as disciplinas');
    setOptions('#periodFilter', uniqueDimension(/data|per[ií]odo|m[eê]s|semana/i), 'Todos os períodos');
    setOptions('#changeFilter', [...new Set(state.rows.map((row) => row.classification))].sort(), 'Todas as alterações');
  }

  function applyFilters() {
    const query = $('#searchInput').value.trim().toLocaleUpperCase('pt-BR');
    const conditions = [
      ['#sheetFilter', (row) => row.sheet],
      ['#regionalFilter', (row) => dimension(row, /regional/i)],
      ['#packageFilter', (row) => dimension(row, /pacote/i)],
      ['#activityFilter', (row) => dimension(row, /atividade|servi[cç]o/i)],
      ['#equipmentFilter', (row) => dimension(row, /equipamento|ativo/i)],
      ['#disciplineFilter', (row) => dimension(row, /disciplina|especialidade|tipo de pend/i)],
      ['#periodFilter', (row) => dimension(row, /data|per[ií]odo|m[eê]s|semana/i)],
      ['#changeFilter', (row) => row.classification]
    ];
    state.filtered = state.rows.filter((row) => {
      if (query && !JSON.stringify(row).toLocaleUpperCase('pt-BR').includes(query)) return false;
      return conditions.every(([selector, getter]) => !$(selector).value || getter(row) === $(selector).value);
    });
    state.page = 1;
    renderTable();
  }

  function renderTable() {
    const pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const pageRows = state.filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    $('#changesTable').innerHTML = pageRows.length ? pageRows.map((row) => `<tr>
      <td>${escapeHtml(row.sheet)}</td><td>${escapeHtml(row.key)}</td>
      <td>${escapeHtml(dimension(row, /regional/i) || '—')}</td><td>${escapeHtml(dimension(row, /pacote/i) || '—')}</td>
      <td>${escapeHtml(dimension(row, /disciplina|especialidade|tipo de pend/i) || '—')}</td><td>${escapeHtml(dimension(row, /atividade|servi[cç]o/i) || '—')}</td>
      <td>${escapeHtml(row.field)}</td>
      <td>${escapeHtml(row.previous)}</td><td>${escapeHtml(row.current)}</td>
      <td>${row.variation === null ? '—' : escapeHtml(formatNumber(row.variation, 2))}</td>
      <td><span class="tag ${escapeHtml(row.classification)}">${escapeHtml(row.classification.replace(/_/g, ' '))}</span></td>
    </tr>`).join('') : '<tr><td colspan="11">Nenhuma alteração encontrada.</td></tr>';
    $('#tableCount').textContent = `${formatNumber(state.filtered.length)} resultados`;
    $('#pageLabel').textContent = `${state.page} / ${pages}`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= pages;
  }

  function renderLocations() {
    const groups = new Map();
    state.rows.forEach((row) => {
      const location = dimension(row, /pacote|regional|trecho/i) || row.sheet;
      groups.set(location, (groups.get(location) || 0) + 1);
    });
    const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    $('#locationChanges').innerHTML = ranked.length ? ranked.map(([name, count]) => `<div class="location-item"><i></i><div><strong>${escapeHtml(name)}</strong><small>trecho ou conjunto afetado</small></div><b>${formatNumber(count)}</b></div>`).join('') : '<p>Nenhuma localização alterada.</p>';
  }

  function renderTimeline(currentId) {
    $('#versionCount').textContent = `${state.versions.length} versões`;
    $('#timeline').innerHTML = state.versions.map((version) => `<article class="timeline-item ${version.id === currentId ? 'current' : ''}">
      <span>${escapeHtml(formatDate(version.uploadedAt))}</span><strong>#${escapeHtml(shortId(version.id))} · ${escapeHtml(version.user || 'operador')}</strong>
      <small>${formatNumber(version.comparisonSummary?.totalChanges || 0)} alterações · ${escapeHtml(version.status)}</small>
      <button type="button" data-compare="${escapeHtml(version.id)}">Comparar</button>
      ${version.id !== currentId ? `<button type="button" data-restore="${escapeHtml(version.id)}">Restaurar</button>` : ''}
    </article>`).join('');
  }

  function renderTrend() {
    const key = $('#chartMetric').value;
    const points = [...state.versions].reverse().slice(-12).map((version) => ({ label: new Date(version.uploadedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: Number(version.comparisonSummary?.[key] || 0) }));
    const width = 700, height = 240, pad = 34, max = Math.max(1, ...points.map((point) => point.value));
    const coords = points.map((point, index) => ({ ...point, x: pad + index * ((width - pad * 2) / Math.max(1, points.length - 1)), y: height - pad - point.value / max * (height - pad * 2) }));
    if (!coords.length) { $('#trendChart').innerHTML = '<p>Histórico insuficiente.</p>'; return; }
    const line = coords.map((point) => `${point.x},${point.y}`).join(' ');
    const area = `${pad},${height - pad} ${line} ${coords.at(-1).x},${height - pad}`;
    $('#trendChart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${[0,1,2,3].map((index) => `<line class="chart-grid" x1="${pad}" y1="${pad + index * 52}" x2="${width - pad}" y2="${pad + index * 52}"/>`).join('')}
      <polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/>
      ${coords.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"/><text class="chart-value" x="${point.x}" y="${point.y - 10}" text-anchor="middle">${point.value}</text><text class="chart-label" x="${point.x}" y="${height - 12}" text-anchor="middle">${point.label}</text>`).join('')}
    </svg>`;
  }

  function download(name, mime, content) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    const headers = ['Aba', 'Registro', 'Regional', 'Pacote', 'Disciplina', 'Atividade', 'Campo', 'Anterior', 'Atual', 'Variação', 'Classificação'];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = state.filtered.map((row) => [row.sheet, row.key, dimension(row, /regional/i), dimension(row, /pacote/i), dimension(row, /disciplina|especialidade|tipo de pend/i), dimension(row, /atividade|servi[cç]o/i), row.field, row.previous, row.current, row.variation, row.classification]);
    download(`fico_comparacao_${Date.now()}.csv`, 'text/csv;charset=utf-8', `\ufeff${[headers, ...rows].map((row) => row.map(quote).join(';')).join('\n')}`);
  }

  async function restoreSelected() {
    if (!state.restoreId) return;
    showState('Restaurando versão', 'A base atual será preservada automaticamente.', '↻');
    try {
      await api(`/api/v1/dashboards/${encodeURIComponent(state.dashboard)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: state.restoreId }) });
      await loadVersions();
      await compareSelected();
    } catch (error) {
      showState('Restauração não realizada', `${error.message} A versão atual foi preservada.`, '!');
    }
  }

  async function bootAuthenticated() {
    showState('Carregando histórico', 'Buscando versões disponíveis.', '↻');
    try {
      await loadDashboards();
      if (await loadVersions()) await compareSelected();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { logout(); return; }
      showState('Erro de carregamento', error.message, '!');
    }
  }

  function bind() {
    $('#loginForm').addEventListener('submit', login);
    $('#themeToggle').addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('fico-theme', theme);
    });
    $('#dashboardSelect').addEventListener('change', async (event) => { state.dashboard = event.target.value; showState('Carregando dashboard', 'Buscando histórico correspondente.', '↻'); if (await loadVersions()) await compareSelected(); });
    $('#compareButton').addEventListener('click', compareSelected);
    $('#swapVersions').addEventListener('click', () => { const from = $('#fromVersion').value; $('#fromVersion').value = $('#toVersion').value; $('#toVersion').value = from; compareSelected(); });
    $('#chartMetric').addEventListener('change', renderTrend);
    ['#searchInput','#sheetFilter','#regionalFilter','#packageFilter','#activityFilter','#equipmentFilter','#disciplineFilter','#periodFilter','#changeFilter'].forEach((selector) => $(selector).addEventListener(selector === '#searchInput' ? 'input' : 'change', applyFilters));
    $('#prevPage').addEventListener('click', () => { state.page -= 1; renderTable(); });
    $('#nextPage').addEventListener('click', () => { state.page += 1; renderTable(); });
    $('#exportJson').addEventListener('click', () => download(`fico_comparacao_${Date.now()}.json`, 'application/json', JSON.stringify(state.comparison, null, 2)));
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#printReport').addEventListener('click', () => window.print());
    $('#timeline').addEventListener('click', (event) => {
      const compare = event.target.closest('[data-compare]');
      if (compare) { $('#fromVersion').value = compare.dataset.compare; compareSelected(); return; }
      const restore = event.target.closest('[data-restore]');
      if (restore) { state.restoreId = restore.dataset.restore; $('#restoreDialog').showModal(); }
    });
    $('#confirmRestore').addEventListener('click', restoreSelected);
  }

  bind();
  if (state.token) bootAuthenticated();
})();
