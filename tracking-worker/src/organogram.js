const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_STATE_BYTES = 500_000;

function cors(request) {
  const origin = request.headers.get('origin');
  const allowed = !origin || origin === 'https://automacaofico.github.io' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed && origin ? origin : 'https://automacaofico.github.io',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function reply(request, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(request), 'cache-control': 'no-store' } });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytesLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeOrganogramState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Dados do organograma inválidos.' };
  if (!Array.isArray(value.nodes) || !Array.isArray(value.contratos) || !Array.isArray(value.carros) || !Array.isArray(value.governanca)) {
    return { error: 'Estrutura do organograma incompleta.' };
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) return { error: 'O organograma excedeu o limite de armazenamento.' };
  return { data: value, serialized };
}

async function authenticatedSession(request, env) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return env.DB.prepare('SELECT token_hash FROM organogram_sessions WHERE token_hash=? AND datetime(expires_at)>CURRENT_TIMESTAMP')
    .bind(await sha256(token)).first();
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!env.ORGANOGRAM_PASSWORD || String(body.password || '') !== env.ORGANOGRAM_PASSWORD) {
    return reply(request, { ok: false, error: 'Senha incorreta.' }, 401);
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM organogram_sessions WHERE datetime(expires_at)<=CURRENT_TIMESTAMP'),
    env.DB.prepare('INSERT INTO organogram_sessions (token_hash,expires_at) VALUES (?,?)').bind(await sha256(token), expiresAt)
  ]);
  return reply(request, { ok: true, token, expiresAt });
}

async function readState(request, env) {
  if (!await authenticatedSession(request, env)) return reply(request, { ok: false, error: 'Acesso expirado.' }, 401);
  const row = await env.DB.prepare('SELECT data_json,revision,updated_at FROM organogram_state WHERE singleton_id=1').first();
  return reply(request, {
    ok: true,
    state: row ? JSON.parse(row.data_json) : null,
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null
  });
}

async function saveState(request, env) {
  if (!await authenticatedSession(request, env)) return reply(request, { ok: false, error: 'Acesso expirado.' }, 401);
  const body = await request.json().catch(() => ({}));
  const normalized = normalizeOrganogramState(body.state);
  if (normalized.error) return reply(request, { ok: false, error: normalized.error }, 400);

  const expectedRevision = Math.max(0, Number(body.expectedRevision) || 0);
  const current = await env.DB.prepare('SELECT data_json,revision,updated_at FROM organogram_state WHERE singleton_id=1').first();
  if (!current) {
    if (expectedRevision !== 0) return reply(request, { ok: false, error: 'O organograma foi alterado em outro acesso.', conflict: true, revision: 0 }, 409);
    await env.DB.prepare('INSERT INTO organogram_state (singleton_id,data_json,revision,updated_at) VALUES (1,?,1,CURRENT_TIMESTAMP)')
      .bind(normalized.serialized).run();
    const created = await env.DB.prepare('SELECT revision,updated_at FROM organogram_state WHERE singleton_id=1').first();
    return reply(request, { ok: true, revision: Number(created.revision), updatedAt: created.updated_at });
  }

  if (expectedRevision !== Number(current.revision)) {
    return reply(request, { ok: false, error: 'O organograma foi alterado em outro acesso.', conflict: true, revision: Number(current.revision), updatedAt: current.updated_at }, 409);
  }
  const result = await env.DB.prepare('UPDATE organogram_state SET data_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND revision=?')
    .bind(normalized.serialized, expectedRevision).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    const latest = await env.DB.prepare('SELECT revision,updated_at FROM organogram_state WHERE singleton_id=1').first();
    return reply(request, { ok: false, error: 'O organograma foi alterado em outro acesso.', conflict: true, revision: Number(latest?.revision || 0), updatedAt: latest?.updated_at || null }, 409);
  }
  const saved = await env.DB.prepare('SELECT revision,updated_at FROM organogram_state WHERE singleton_id=1').first();
  return reply(request, { ok: true, revision: Number(saved.revision), updatedAt: saved.updated_at });
}

export async function routeOrganogram(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/v1/organogram/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method === 'POST' && path === '/api/v1/organogram/login') return login(request, env);
  if (request.method === 'GET' && path === '/api/v1/organogram/state') return readState(request, env);
  if (request.method === 'POST' && path === '/api/v1/organogram/state') return saveState(request, env);
  return reply(request, { ok: false, error: 'Rota não encontrada.' }, 404);
}
