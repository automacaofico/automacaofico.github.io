import { VersionCoordinator } from './coordinator.js';
import { DASHBOARDS, dashboardById } from './schemas.js';
import { AppError, publicError } from './errors.js';
import { createSession, requireSession } from './auth.js';
import { DriveStore } from './google-drive.js';
import { GitHubPublisher } from './github.js';
import { VersionService } from './version-service.js';

export { VersionCoordinator };

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://automacaofico.github.io').split(',').map((item) => item.trim()).filter(Boolean);
}

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins(env);
  const selected = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': selected,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function requireAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins(env).includes(origin)) {
    throw new AppError('Origem não autorizada.', 403, 'ORIGIN_DENIED');
  }
}

function response(request, env, body, status = 200, extra = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...cors(request, env),
      'Cache-Control': status === 200 ? 'no-store' : 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extra
    }
  });
}

function dashboardService(env, id) {
  const dashboard = dashboardById(id);
  if (!dashboard) throw new AppError('Dashboard desconhecido.', 404, 'DASHBOARD_NOT_FOUND');
  return new VersionService({ drive: new DriveStore(env), github: new GitHubPublisher(env), dashboard, maxBytes: Number(env.MAX_FILE_BYTES || 10485760) });
}

async function checkRate(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const id = env.COORDINATOR.idFromName(`rate:${ip}`);
  const stub = env.COORDINATOR.get(id);
  const result = await stub.fetch('https://internal/internal/rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: Number(env.RATE_LIMIT_ATTEMPTS || 8), windowSeconds: Number(env.RATE_LIMIT_WINDOW_SECONDS || 900) })
  });
  if (!result.ok) throw new AppError('Muitas tentativas. Aguarde alguns minutos.', 429, 'RATE_LIMITED');
}

async function authenticate(request, env) {
  await checkRate(request, env);
  const body = await request.json();
  const session = await createSession(body.password, body.user, env);
  return { ok: true, ...session };
}

async function forwardUpload(request, env, session) {
  const form = await request.formData();
  const dashboard = dashboardById(form.get('dashboard'));
  if (!dashboard) throw new AppError('Dashboard desconhecido.', 404, 'DASHBOARD_NOT_FOUND');
  form.set('dashboard', dashboard.id);
  form.set('user', session.sub || 'operador');
  const id = env.COORDINATOR.idFromName(`dashboard:${dashboard.id}`);
  return env.COORDINATOR.get(id).fetch('https://internal/internal/upload', { method: 'POST', body: form });
}

async function forwardRestore(env, dashboard, versionId, user) {
  const id = env.COORDINATOR.idFromName(`dashboard:${dashboard.id}`);
  return env.COORDINATOR.get(id).fetch('https://internal/internal/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dashboard: dashboard.id, versionId, user })
  });
}

function decodeBase64(value) {
  const binary = atob(value || '');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function legacy(request, env) {
  const body = await request.json();
  await checkRate(request, env);
  const session = await createSession(body.senha, 'operador', env);
  const dashboard = dashboardById(body.repoKey);
  if (!dashboard) throw new AppError('Painel desconhecido.', 404, 'DASHBOARD_NOT_FOUND');
  if (body.action === 'check') {
    const current = await new GitHubPublisher(env).current(dashboard.github);
    return { ok: true, label: dashboard.label, filename: dashboard.github.path, downloadUrl: current.downloadUrl };
  }
  const form = new FormData();
  form.set('dashboard', dashboard.id);
  form.set('user', session.sub);
  form.set('file', new File([decodeBase64(body.contentBase64)], body.filename || dashboard.github.path, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const id = env.COORDINATOR.idFromName(`dashboard:${dashboard.id}`);
  const result = await env.COORDINATOR.get(id).fetch('https://internal/internal/upload', { method: 'POST', body: form });
  const data = await result.json();
  if (!result.ok) throw new AppError(data.error || 'Falha ao atualizar.', result.status, data.code || 'UPLOAD_FAILED', data.details);
  return { ...data, label: dashboard.label, when: new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      requireAllowedOrigin(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
      if (url.pathname === '/' && request.method === 'POST') return response(request, env, await legacy(request, env));
      if (url.pathname === '/api/v1/health' && request.method === 'GET') return response(request, env, { ok: true, service: 'fico-versioning-api', time: new Date().toISOString() });
      if (url.pathname === '/api/v1/dashboards' && request.method === 'GET') {
        return response(request, env, { ok: true, dashboards: Object.values(DASHBOARDS).map(({ id, label }) => ({ id, label })) }, 200, { 'Cache-Control': 'public, max-age=300' });
      }
      if (url.pathname === '/api/v1/auth/session' && request.method === 'POST') return response(request, env, await authenticate(request, env));

      const session = await requireSession(request, env);
      if (url.pathname === '/api/v1/uploads' && request.method === 'POST') {
        const result = await forwardUpload(request, env, session);
        return new Response(result.body, { status: result.status, headers: { ...Object.fromEntries(result.headers), ...cors(request, env), 'Cache-Control': 'no-store' } });
      }

      const versionsMatch = url.pathname.match(/^\/api\/v1\/dashboards\/([^/]+)\/versions$/);
      if (versionsMatch && request.method === 'GET') return response(request, env, { ok: true, ...(await dashboardService(env, versionsMatch[1]).versions()) });

      const currentMatch = url.pathname.match(/^\/api\/v1\/dashboards\/([^/]+)\/comparison$/);
      if (currentMatch && request.method === 'GET') return response(request, env, { ok: true, comparison: await dashboardService(env, currentMatch[1]).currentComparison() });

      const compareMatch = url.pathname.match(/^\/api\/v1\/dashboards\/([^/]+)\/compare$/);
      if (compareMatch && request.method === 'GET') {
        return response(request, env, { ok: true, comparison: await dashboardService(env, compareMatch[1]).comparison(url.searchParams.get('from'), url.searchParams.get('to')) });
      }

      const restoreMatch = url.pathname.match(/^\/api\/v1\/dashboards\/([^/]+)\/restore$/);
      if (restoreMatch && request.method === 'POST') {
        const dashboard = dashboardById(restoreMatch[1]);
        if (!dashboard) throw new AppError('Dashboard desconhecido.', 404, 'DASHBOARD_NOT_FOUND');
        const body = await request.json();
        const result = await forwardRestore(env, dashboard, body.versionId, session.sub);
        return new Response(result.body, { status: result.status, headers: { ...Object.fromEntries(result.headers), ...cors(request, env), 'Cache-Control': 'no-store' } });
      }

      return response(request, env, { ok: false, error: 'Rota inexistente.', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      const result = publicError(error);
      return response(request, env, result.body, result.status);
    }
  }
};
