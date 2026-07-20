import { AppError } from './errors.js';
import { createSessionToken, passwordMatches, verifySessionToken } from './crypto.js';

export function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export async function requireSession(request, env) {
  const payload = await verifySessionToken(env.SESSION_SIGNING_KEY, bearer(request));
  if (!payload) throw new AppError('Sessão inválida ou expirada.', 401, 'UNAUTHORIZED');
  return payload;
}

export async function createSession(password, user, env) {
  if (!(await passwordMatches(password, env.ACCESS_PASSWORD_HASH))) {
    throw new AppError('Senha incorreta.', 401, 'INVALID_PASSWORD');
  }
  const ttl = Number(env.SESSION_TTL_SECONDS || 28800);
  return {
    token: await createSessionToken(env.SESSION_SIGNING_KEY, String(user || 'operador').trim().slice(0, 80) || 'operador', ttl),
    expiresIn: ttl
  };
}
