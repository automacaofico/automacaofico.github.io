const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_STATE_BYTES = 1_000_000;

function cors(request) {
  const origin = request.headers.get('origin');
  const allowed = !origin || origin === 'https://automacaofico.github.io' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed && origin ? origin : 'https://automacaofico.github.io',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function reply(request, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(request), 'cache-control': 'no-store' } });
}

const MACHINES = ['PLASSER', 'MATISA', 'HARSCO'];

function normalizeSocariaState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Dados inválidos.' };
  if (!Array.isArray(value.rows)) return { error: 'Estrutura de lançamentos inválida.' };
  if (value.rows.length > 5000) return { error: 'Número de lançamentos excede o limite permitido.' };
  for (const row of value.rows) {
    if (!row || typeof row !== 'object' || typeof row.dateISO !== 'string') return { error: 'Lançamento inválido encontrado.' };
    for (const m of MACHINES) {
      if (row[m] !== undefined && typeof row[m] !== 'number') return { error: `Valor inválido para ${m}.` };
    }
  }
  const settings = value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings) ? value.settings : {};
  const normalized = { rows: value.rows, settings };
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) return { error: 'A base excedeu o limite de armazenamento.' };
  return { data: normalized, serialized };
}

async function readState(request, env) {
  const row = await env.DB.prepare('SELECT data_json,revision,updated_at FROM socaria_state WHERE singleton_id=1').first();
  return reply(request, {
    ok: true,
    state: row ? JSON.parse(row.data_json) : null,
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null
  });
}

async function saveState(request, env) {
  const body = await request.json().catch(() => ({}));
  const normalized = normalizeSocariaState(body.state);
  if (normalized.error) return reply(request, { ok: false, error: normalized.error }, 400);

  const expectedRevision = Math.max(0, Number(body.expectedRevision) || 0);
  const current = await env.DB.prepare('SELECT data_json,revision,updated_at FROM socaria_state WHERE singleton_id=1').first();
  if (!current) {
    if (expectedRevision !== 0) return reply(request, { ok: false, error: 'A base foi alterada em outro acesso.', conflict: true, revision: 0 }, 409);
    await env.DB.prepare('INSERT INTO socaria_state (singleton_id,data_json,revision,updated_at) VALUES (1,?,1,CURRENT_TIMESTAMP)')
      .bind(normalized.serialized).run();
    const created = await env.DB.prepare('SELECT revision,updated_at FROM socaria_state WHERE singleton_id=1').first();
    return reply(request, { ok: true, revision: Number(created.revision), updatedAt: created.updated_at });
  }

  if (expectedRevision !== Number(current.revision)) {
    return reply(request, { ok: false, error: 'A base foi alterada em outro acesso.', conflict: true, revision: Number(current.revision), updatedAt: current.updated_at }, 409);
  }
  const result = await env.DB.prepare('UPDATE socaria_state SET data_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND revision=?')
    .bind(normalized.serialized, expectedRevision).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    const latest = await env.DB.prepare('SELECT revision,updated_at FROM socaria_state WHERE singleton_id=1').first();
    return reply(request, { ok: false, error: 'A base foi alterada em outro acesso.', conflict: true, revision: Number(latest?.revision || 0), updatedAt: latest?.updated_at || null }, 409);
  }
  const saved = await env.DB.prepare('SELECT revision,updated_at FROM socaria_state WHERE singleton_id=1').first();
  return reply(request, { ok: true, revision: Number(saved.revision), updatedAt: saved.updated_at });
}

export async function routeSocaria(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/v1/socaria/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method === 'GET' && path === '/api/v1/socaria/state') return readState(request, env);
  if (request.method === 'POST' && path === '/api/v1/socaria/state') return saveState(request, env);
  return reply(request, { ok: false, error: 'Rota não encontrada.' }, 404);
}
