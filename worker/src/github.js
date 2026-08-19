import { AppError } from './errors.js';

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(output);
}

export class GitHubPublisher {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
  }

  async request(path, init = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'fico-versioning-worker',
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('GitHub API error', response.status, detail.slice(0, 500));
      throw new AppError('Falha ao publicar a nova base no dashboard.', 502, 'GITHUB_ERROR');
    }
    return response.json();
  }

  async current(target) {
    const path = `/repos/${target.owner}/${target.repo}/contents/${encodePath(target.path)}`;
    const metadata = await this.request(path);
    const rawResponse = await fetch(metadata.download_url, { headers: { Authorization: `Bearer ${this.token}` }, cache: 'no-store' });
    if (!rawResponse.ok) throw new AppError('Não foi possível localizar a base atual.', 502, 'CURRENT_BASE_UNAVAILABLE');
    return { sha: metadata.sha, buffer: await rawResponse.arrayBuffer(), downloadUrl: metadata.download_url };
  }

  // Como current(), mas devolve null em vez de lançar erro quando o arquivo ainda não existe
  // (usado pelos dados manuais, cujo arquivo só é criado no primeiro salvamento).
  async currentOrNull(target) {
    const path = `/repos/${target.owner}/${target.repo}/contents/${encodePath(target.path)}`;
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'fico-versioning-worker'
      }
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text();
      console.error('GitHub API error', response.status, detail.slice(0, 500));
      throw new AppError('Falha ao consultar arquivo atual.', 502, 'GITHUB_ERROR');
    }
    const metadata = await response.json();
    const rawResponse = await fetch(metadata.download_url, { headers: { Authorization: `Bearer ${this.token}` }, cache: 'no-store' });
    if (!rawResponse.ok) throw new AppError('Não foi possível localizar o arquivo atual.', 502, 'CURRENT_FILE_UNAVAILABLE');
    return { sha: metadata.sha, buffer: await rawResponse.arrayBuffer() };
  }

  async update(target, buffer, sha, message) {
    const path = `/repos/${target.owner}/${target.repo}/contents/${encodePath(target.path)}`;
    return this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: bytesToBase64(buffer), sha })
    });
  }
}
