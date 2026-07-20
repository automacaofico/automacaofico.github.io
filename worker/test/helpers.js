import * as XLSX from 'xlsx';

export function workbookBuffer({ activityKm = 1000, materialReceived = 10 } = {}) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ACOMPANHAMENTO'],
    ['Atividade', 'KM Real'],
    ['Montagem de grade', activityKm]
  ]), 'ENTRADA');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['CURVA'],
    ['ITEM', new Date('2026-07-01')],
    ['REALIZADO', 0.1]
  ]), 'CURVAS');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['DESCRIÇÃO', 'UNIDADE', 'QNDE RECEBIDA', 'QNDE CONSUMIDA'],
    ['Trilho', 't', materialReceived, 4]
  ]), 'MATERIAIS');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export class FakeDrive {
  constructor({ failMove = false } = {}) {
    this.failMove = failMove;
    this.files = new Map();
    this.byName = new Map();
    this.counter = 0;
  }

  async ensureDashboardFolders() {
    return { ROOT: 'root', BASE_ATUAL: 'current', HISTORICO: 'history', JSON: 'json', COMPARACOES: 'diff', _TRANSACOES: 'temp', LOGS: 'logs' };
  }

  async find(parent, name) {
    const id = this.byName.get(`${parent}/${name}`);
    return id ? { id, name } : null;
  }

  async upload({ parentId, name, content, appProperties = {} }) {
    const id = `f${++this.counter}`;
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(await content.arrayBuffer?.() || content);
    this.files.set(id, { id, name, parentId, content: bytes, appProperties });
    this.byName.set(`${parentId}/${name}`, id);
    return { id, name, parents: [parentId], appProperties };
  }

  async upsert(parentId, name, mimeType, content, appProperties = {}) {
    const existing = await this.find(parentId, name);
    if (!existing) return this.upload({ parentId, name, mimeType, content, appProperties });
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    this.files.set(existing.id, { id: existing.id, name, parentId, content: bytes, appProperties });
    return { id: existing.id, name, parents: [parentId], appProperties };
  }

  async download(id) {
    const bytes = this.files.get(id).content;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async downloadJson(id) {
    return JSON.parse(new TextDecoder().decode(this.files.get(id).content));
  }

  async move(id, addParent, removeParent, appProperties = {}) {
    if (this.failMove) throw new Error('move failed');
    const file = this.files.get(id);
    file.parentId = addParent;
    file.appProperties = appProperties;
    return { id, name: file.name, parents: [addParent], appProperties };
  }

  async setProperties(id, appProperties) {
    this.files.get(id).appProperties = appProperties;
    return { id, appProperties };
  }
}

export class FakeGitHub {
  constructor(buffer) {
    this.buffer = buffer;
    this.sha = 'old-sha';
    this.updates = [];
  }

  async current() {
    return { buffer: this.buffer, sha: this.sha, downloadUrl: 'https://example.invalid/current.xlsx' };
  }

  async update(target, buffer, sha, message) {
    this.updates.push({ target, buffer, sha, message });
    return { content: { sha: `sha-${this.updates.length}` }, commit: { sha: `commit-${this.updates.length}` } };
  }
}
