const encoder = new TextEncoder();

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createSessionToken(secret, subject, ttlSeconds) {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(encoder.encode(JSON.stringify({ sub: subject || 'operador', iat: now, exp: now + ttlSeconds })));
  const signature = base64Url(await hmac(secret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

export async function verifySessionToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = await hmac(secret, `${parts[0]}.${parts[1]}`);
  const actual = decodeBase64Url(parts[2]);
  if (expected.length !== actual.length) return null;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ actual[index];
  if (mismatch) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function passwordMatches(password, expectedHash) {
  if (!password || !expectedHash) return false;
  return (await sha256(password)).toLowerCase() === expectedHash.trim().toLowerCase();
}
