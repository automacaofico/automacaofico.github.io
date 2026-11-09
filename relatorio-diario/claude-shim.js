/* Relatório Diário FICO — cópia somente leitura no GitHub Pages, protegida por senha.
 * O artefato original guarda os dados no banco compartilhado do claude.ai (window.claude.use('db')).
 * Fora do claude.ai esse recurso não existe; este arquivo o substitui por um banco SOMENTE LEITURA
 * alimentado por data/relatorio.enc.json (criptografado; só abre com a senha, no navegador). */
(function () {
  'use strict';
  var SNAP = null;
  var CHAVE = 'fico-relatorio-senha';

  function b64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

  async function decifrar(env, senha) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(env.salt), iterations: env.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct)); // lança erro se a senha estiver errada
    if (env.gz) {
      var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = await new Response(stream).arrayBuffer();
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  function pedirSenha(env) {
    return new Promise(function (resolve) {
      var guardada = null;
      try { guardada = localStorage.getItem(CHAVE) || sessionStorage.getItem(CHAVE); } catch (e) {}
      function tentar(senha, lembrar, fb) {
        return decifrar(env, senha).then(function (dados) {
          try { sessionStorage.setItem(CHAVE, senha); if (lembrar) localStorage.setItem(CHAVE, senha); } catch (e) {}
          resolve(dados); return true;
        }).catch(function () { if (fb) fb('Senha incorreta. Tente novamente.'); return false; });
      }
      function montar() {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;background:#06223d;font-family:system-ui,sans-serif';
        ov.innerHTML = '<form style="background:#fff;border-radius:16px;padding:28px 26px;width:min(380px,100%);box-shadow:0 20px 50px rgba(0,0,0,.35);display:grid;gap:14px">' +
          '<div style="font:800 1.25rem system-ui;color:#06223d">Relatório Diário FICO</div>' +
          '<div style="font-size:.9rem;color:#566a80">Painel de acesso restrito. Digite a senha para continuar.</div>' +
          '<input type="password" autocomplete="current-password" placeholder="Senha" aria-label="Senha" style="font:inherit;padding:11px 12px;border:1px solid #d5dfea;border-radius:10px;width:100%">' +
          '<label style="font-size:.82rem;color:#566a80;display:flex;gap:8px;align-items:center"><input type="checkbox"> Manter neste aparelho</label>' +
          '<div class="msg" role="alert" style="color:#b8322b;font-size:.85rem;min-height:1.1em"></div>' +
          '<button type="submit" style="font:700 .95rem system-ui;padding:11px;border:0;border-radius:10px;background:#f89b32;color:#3a2000;cursor:pointer">Entrar</button></form>';
        document.body.appendChild(ov);
        var f = ov.querySelector('form'), inp = f.querySelector('input[type=password]'), chk = f.querySelector('input[type=checkbox]'), msg = f.querySelector('.msg'), btn = f.querySelector('button');
        inp.focus();
        f.addEventListener('submit', function (e) {
          e.preventDefault(); if (!inp.value) return;
          btn.disabled = true; btn.textContent = 'Verificando…'; msg.textContent = '';
          tentar(inp.value, chk.checked, function (m) { msg.textContent = m; btn.disabled = false; btn.textContent = 'Entrar'; inp.select(); })
            .then(function (ok) { if (ok) ov.remove(); });
        });
      }
      if (guardada) tentar(guardada, false, null).then(function (ok) { if (!ok) { try { localStorage.removeItem(CHAVE); sessionStorage.removeItem(CHAVE); } catch (e) {} montar(); } });
      else montar();
    });
  }

  function load() {
    return fetch('./data/relatorio.enc.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(pedirSenha);
  }

  function readOnly() {
    var e = new Error('Cópia somente leitura: nada é gravado aqui.'); e.code = 'read-only';
    return Promise.reject(e);
  }
  function docSnap(id, data) { return { id: id, exists: data != null, data: function () { return data; } }; }
  function colSnap(name) {
    var m = (SNAP.collections && SNAP.collections[name]) || {};
    var docs = Object.keys(m).sort().map(function (id) { return docSnap(id, m[id]); });
    return { docs: docs, size: docs.length, empty: docs.length === 0, forEach: function (cb) { docs.forEach(cb); } };
  }
  function docRef(col, id) {
    var data = ((SNAP.collections && SNAP.collections[col]) || {})[id];
    return {
      id: id,
      get: function () { return Promise.resolve(docSnap(id, data)); },
      onSnapshot: function (ok) { setTimeout(function () { ok(docSnap(id, data)); }, 0); return function () {}; },
      set: readOnly, update: readOnly, delete: readOnly
    };
  }
  var db = {
    collection: function (name) {
      return {
        get: function () { return Promise.resolve(colSnap(name)); },
        onSnapshot: function (ok) { setTimeout(function () { ok(colSnap(name)); }, 0); return function () {}; },
        doc: function (id) { return docRef(name, id); }
      };
    },
    doc: function (path) { var p = String(path).split('/'); return docRef(p[0], p[1]); }
  };

  var MIME = { csv: 'text/csv;charset=utf-8', txt: 'text/plain;charset=utf-8', html: 'text/html;charset=utf-8', json: 'application/json', pdf: 'application/pdf' };
  var downloads = {
    save: function (o) {
      return new Promise(function (resolve) {
        var ext = (String(o.filename).split('.').pop() || '').toLowerCase();
        var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: MIME[ext] || 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = o.filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); resolve(); }, 500);
      });
    }
  };

  function banner(s) {
    var d = s.generatedAt ? new Date(s.generatedAt) : null;
    var quando = d && !isNaN(d) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    var b = document.createElement('div');
    b.setAttribute('role', 'note');
    b.style.cssText = 'background:#e3edf8;color:#0d1f33;font:600 12.5px/1.4 system-ui,sans-serif;padding:7px 16px;text-align:center;border-bottom:1px solid #d5dfea';
    b.textContent = 'Cópia somente leitura do Relatório Diário FICO · dados de ' + quando + ' · lançamentos e análises por IA ficam no painel original';
    document.body.insertBefore(b, document.body.firstChild);
  }

  window.claude = {
    use: function (name) {
      if (name === 'db') return load().then(function (s) { SNAP = s; banner(s); return db; }).catch(function () { return null; });
      if (name === 'user') return Promise.resolve({ can: function () { return Promise.resolve(false); } });
      if (name === 'downloads') return Promise.resolve(downloads);
      return Promise.resolve(null); // 'sample' (IA) não existe fora do claude.ai
    }
  };
})();
