import { AppError } from './errors.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const encoder = new TextEncoder();
let tokenCache = null;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

async function serviceAccountGoogleToken(env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64Url(encoder.encode(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', pemBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new AppError('Credencial do Google Drive inválida.', 500, 'DRIVE_CREDENTIAL_INVALID');
  }
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new AppError('Google Drive recusou a autenticação.', 502, 'DRIVE_AUTH_FAILED');
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function googleToken(env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.value;
  const hasOAuth = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!hasOAuth) return serviceAccountGoogleToken(env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new AppError('Google Drive recusou a autenticação.', 502, 'DRIVE_AUTH_FAILED');
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class DriveStore {
  constructor(env) {
    this.env = env;
  }

  async request(path, init = {}) {
    const token = await googleToken(this.env);
    const response = await fetch(path.startsWith('http') ? path : `${DRIVE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Drive API error', response.status, detail.slice(0, 500));
      throw new AppError('Falha no armazenamento do Google Drive.', 502, 'DRIVE_ERROR');
    }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response.arrayBuffer();
  }

  async find(parentId, name) {
    const query = `'${escapeQuery(parentId)}' in parents and name='${escapeQuery(name)}' and trashed=false`;
    const params = new URLSearchParams({ q: query, fields: 'files(id,name,mimeType,parents,appProperties,modifiedTime,size)', pageSize: '10', spaces: 'drive', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' });
    const result = await this.request(`/files?${params}`);
    return result.files?.[0] || null;
  }

  async createFolder(parentId, name) {
    return this.request('/files?supportsAllDrives=true&fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
    });
  }

  async ensureFolder(parentId, name) {
    const existing = await this.find(parentId, name);
    if (existing) return existing.id;
    return (await this.createFolder(parentId, name)).id;
  }

  async ensureDashboardFolders(dashboardId) {
    const root = this.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!root) throw new AppError('Pasta raiz do Google Drive não configurada.', 500, 'DRIVE_ROOT_MISSING');
    const dashboard = await this.ensureFolder(root, dashboardId.toUpperCase());
    const names = ['BASE_ATUAL', 'HISTORICO', 'JSON', 'COMPARACOES', '_TRANSACOES', 'LOGS'];
    const entries = await Promise.all(names.map(async (name) => [name, await this.ensureFolder(dashboard, name)]));
    return { ROOT: dashboard, ...Object.fromEntries(entries) };
  }

  async upload({ parentId, name, mimeType, content, appProperties = {} }) {
    const boundary = `fico_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [parentId], mimeType, appProperties });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`
    ]);
    return this.request(`${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,appProperties`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
  }

  async replace({ fileId, name, mimeType, content, appProperties = {} }) {
    const boundary = `fico_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, mimeType, appProperties });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`
    ]);
    return this.request(`${DRIVE_UPLOAD}/files/${fileId}?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,appProperties`, {
      method: 'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
  }

  async upsert(parentId, name, mimeType, content, appProperties = {}) {
    const existing = await this.find(parentId, name);
    return existing
      ? this.replace({ fileId: existing.id, name, mimeType, content, appProperties })
      : this.upload({ parentId, name, mimeType, content, appProperties });
  }

  async download(fileId) {
    return this.request(`/files/${fileId}?alt=media&supportsAllDrives=true`);
  }

  async downloadJson(fileId) {
    const buffer = await this.download(fileId);
    return JSON.parse(new TextDecoder().decode(buffer));
  }

  async move(fileId, addParent, removeParent, appProperties = null) {
    const params = new URLSearchParams({ addParents: addParent, removeParents: removeParent, supportsAllDrives: 'true', fields: 'id,name,parents,appProperties' });
    return this.request(`/files/${fileId}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appProperties ? { appProperties } : {})
    });
  }

  async setProperties(fileId, appProperties) {
    return this.request(`/files/${fileId}?supportsAllDrives=true&fields=id,appProperties`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties })
    });
  }

  async remove(fileId) {
    return this.request(`/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
  }
}
