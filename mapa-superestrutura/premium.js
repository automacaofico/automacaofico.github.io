/* Mapa Superestrutura — acabamento premium: logo animada, números que contam, traçado que acende,
   pulso nas frentes, Vista 3D e o "Voo pela via". Depende da ponte window.__mapaApp exposta por app.js. */
(() => {
  'use strict';
  const A = window.__mapaApp;
  if (!A) return;
  const S = A.state;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- logo FICO animada (Lottie), versão certa para cada tema ---------- */
  (function logo() {
    const host = $('brandLogo');
    if (!host || reduce || !window.lottie) return;
    const cache = {};
    let anim = null, token = 0;
    async function load(dark) {
      const file = dark ? 'fico-logo-branco.json' : 'fico-logo-cor.json';
      const mine = ++token;
      try {
        const data = cache[file] || (cache[file] = await fetch('assets/brand/' + file).then(r => r.json()));
        if (mine !== token) return;
        if (anim) anim.destroy();
        host.querySelectorAll('.lottie-box').forEach(n => n.remove());
        const box = document.createElement('span');
        box.className = 'lottie-box';
        host.appendChild(box);
        anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: data, rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
        let looping = false;
        anim.addEventListener('DOMLoaded', () => { host.classList.add('has-lottie'); anim.playSegments([0, 76], true); });
        anim.addEventListener('complete', () => { if (!looping) { looping = true; anim.loop = true; anim.playSegments([76, 196], true); } });
      } catch (e) { /* mantém a imagem estática */ }
    }
    const isDark = () => document.documentElement.dataset.theme === 'dark';
    load(isDark());
    new MutationObserver(() => load(isDark())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  /* ---------- números que contam de zero até o valor ---------- */
  function countUp(node) {
    if (!node) return;
    const text = node.textContent.trim();
    if (node.dataset.cu === text) return;
    node.dataset.cu = text;
    if (reduce) return;
    const m = text.match(/^(\D*?)(\d[\d.,]*)(.*)$/);
    if (!m) return;
    const [, pre, num, suf] = m;
    const dec = (num.split(',')[1] || '').length;
    const value = parseFloat(num.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value === 0) return;
    const t0 = performance.now(), dur = 1000;
    (function step(now) {
      const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      node.textContent = k >= 1 ? text : pre + (value * e).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  const num = text => { const m = String(text).match(/(\d[\d.,]*)/); return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : 0; };

  let firstRender = true;
  document.addEventListener('fico-render', () => {
    ['metricStarted', 'metricRelease', 'metricLeader', 'metricCushion', 'detailReal', 'detailPercent'].forEach(id => countUp($(id)));
    // barras finas sob os indicadores de percentual
    [['metricRelease', 'metricRelease'], ['metricCushion', 'metricCushion']].forEach(([id]) => {
      const card = $(id) && $(id).closest('article');
      if (card) card.style.setProperty('--p', clamp(num($(id).dataset.cu || $(id).textContent), 0, 100) + '%');
    });
    // lista de atividades: índice para a entrada em sequência (só na primeira vez)
    const list = $('activityList');
    list.querySelectorAll('.activity-card').forEach((card, i) => card.style.setProperty('--n', i));
    if (firstRender) {
      firstRender = false;
      list.classList.add('intro');
      setTimeout(() => list.classList.remove('intro'), 2200);
      countUp(document.querySelector('.hero-mark span'));
    }
    // matriz: barra de avanço dentro da célula
    document.querySelectorAll('#activityTableBody tr').forEach(row => {
      const cell = row.children[4];
      if (cell) row.style.setProperty('--p', clamp(num(cell.textContent), 0, 100) + '%');
      if (cell) cell.style.setProperty('--p', clamp(num(cell.textContent), 0, 100) + '%');
    });
  });

  /* ---------- busca e filtros da lista de atividades ---------- */
  $('activitySearch').addEventListener('input', event => { S.activityQuery = A.norm(event.target.value); A.renderActivities(); document.dispatchEvent(new Event('fico-render')); });
  $('activityChips').addEventListener('click', event => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    S.activityFilter = chip.dataset.filter;
    document.querySelectorAll('#activityChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    A.renderActivities();
    document.dispatchEvent(new Event('fico-render'));
  });

  /* ---------- mapa: traçado que acende pacote a pacote e pulso nas frentes ---------- */
  document.addEventListener('fico-map-ready', () => {
    const map = S.map;
    if (!map || reduce) return;
    // traçado: cada pacote acende em sequência (P01 → P08)
    const t0 = performance.now() + 700, per = 360;
    (function reveal(now) {
      const T = (now - t0) / per;
      const open = base => ['*', base, ['max', 0, ['min', 1, ['-', T, ['-', ['get', 'idx'], 1]]]]];
      if (T < 0) { map.setPaintProperty('axis-casing', 'line-opacity', 0); map.setPaintProperty('package-lines', 'line-opacity', 0); return requestAnimationFrame(reveal); }
      if (T < PACKAGES_COUNT + 1) {
        map.setPaintProperty('axis-casing', 'line-opacity', open(.88));
        map.setPaintProperty('package-lines', 'line-opacity', open(.82));
        requestAnimationFrame(reveal);
      } else {
        map.setPaintProperty('axis-casing', 'line-opacity', .88);
        map.setPaintProperty('package-lines', 'line-opacity', .82);
      }
    })(performance.now());

    // pulso: um halo que se expande a partir de cada frente atual
    map.addLayer({ id: 'fronts-pulse', type: 'circle', source: 'fronts', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-opacity': 0, 'circle-pitch-alignment': 'map' } }, 'fronts');
    let last = 0, shown = true;
    (function pulse(now) {
      requestAnimationFrame(pulse);
      if (now - last < 34 || document.hidden) return;
      last = now;
      const visible = map.getLayoutProperty('fronts', 'visibility') !== 'none';
      if (visible !== shown) { shown = visible; map.setLayoutProperty('fronts-pulse', 'visibility', visible ? 'visible' : 'none'); }
      if (!visible) return;
      const phase = (now % 2000) / 2000;
      map.setPaintProperty('fronts-pulse', 'circle-radius', 8 + 20 * phase);
      map.setPaintProperty('fronts-pulse', 'circle-opacity', .5 * Math.pow(1 - phase, 1.6));
    })(performance.now());
  });
  const PACKAGES_COUNT = A.PACKAGES.length;

  /* ---------- Vista 3D ---------- */
  let tilted = false;
  $('tiltButton').addEventListener('click', () => {
    if (!S.map) return;
    tilted = !tilted;
    $('tiltButton').setAttribute('aria-pressed', String(tilted));
    S.map.easeTo({ pitch: tilted ? 58 : 0, bearing: tilted ? -18 : 0, duration: reduce ? 0 : 1200 });
  });

  /* ---------- Voo pela via: câmera cinematográfica ao longo do traçado ---------- */
  const fly = { on: false, raf: 0, t0: 0, bearing: 0 };
  const bearingBetween = (a, b) => {
    const rad = x => x * Math.PI / 180, dLon = rad(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  const leadStation = () => {
    const ends = S.activities.filter(a => !a.material && a.actualEnd > 0).map(a => a.actualEnd);
    return ends.length ? Math.max(...ends) : A.OBRA.end;
  };
  function stopFly(returnToFit = true) {
    if (!fly.on) return;
    fly.on = false;
    cancelAnimationFrame(fly.raf);
    document.body.classList.remove('flying');
    $('flyHud').hidden = true;
    $('flyButton').classList.remove('on');
    $('flyButton').lastChild.textContent = 'Voo pela via';
    if (S.map) {
      const view = { pitch: tilted ? 58 : 0, bearing: tilted ? -18 : 0 };
      if (returnToFit) A.fitCurrent({ ...view, duration: 1400 }); else S.map.easeTo({ ...view, duration: 800 });
    }
  }
  function startFly() {
    if (!S.map || !S.mapReady || !S.axis.length) return;
    if (S.replay.active) A.closeReplay();
    const total = leadStation();
    const duration = clamp(total / 1000 * 190, 14000, 34000);
    const first = A.pointAtStation(0);
    fly.on = true;
    document.body.classList.add('flying');
    $('flyHud').hidden = false;
    $('flyButton').classList.add('on');
    $('flyButton').lastChild.textContent = 'Encerrar voo';
    fly.bearing = bearingBetween(first, A.pointAtStation(1200));
    S.map.flyTo({ center: first, zoom: 12.6, pitch: 62, bearing: fly.bearing, duration: 1800, essential: true });
    setTimeout(() => {
      if (!fly.on) return;
      fly.t0 = performance.now();
      const step = now => {
        if (!fly.on) return;
        const p = clamp((now - fly.t0) / duration, 0, 1), eased = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, st = eased * total;
        const here = A.pointAtStation(st), ahead = A.pointAtStation(Math.min(total, st + 1400));
        const target = bearingBetween(here, ahead);
        let diff = ((target - fly.bearing + 540) % 360) - 180;
        fly.bearing = (fly.bearing + diff * .07 + 360) % 360;
        S.map.jumpTo({ center: here, bearing: fly.bearing, pitch: 62, zoom: 13.1 });
        $('flyKm').textContent = A.station(st);
        $('flyPackage').textContent = A.packageAt(st).name;
        $('flyBar').style.width = (p * 100).toFixed(1) + '%';
        if (p < 1) fly.raf = requestAnimationFrame(step); else stopFly();
      };
      fly.raf = requestAnimationFrame(step);
    }, 1850);
  }
  $('flyButton').addEventListener('click', () => (fly.on ? stopFly() : startFly()));
  $('flyStop').addEventListener('click', () => stopFly());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') stopFly(); });
  // interação do usuário com o mapa durante o voo encerra o voo
  document.addEventListener('fico-map-ready', () => { ['mousedown', 'wheel', 'touchstart'].forEach(type => S.map.getCanvas().addEventListener(type, () => stopFly(false), { passive: true })); });
})();
