import { AppError } from './errors.js';
import { sha256 } from './crypto.js';
import { compareVersions, firstVersionComparison } from './diff.js';
import { validateAndNormalize } from './workbook.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSON_MIME = 'application/json';

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function fortalezaIso(date = new Date()) {
  return new Date(date.getTime() - 3 * 3600000).toISOString().replace('Z', '-03:00');
}

function fileStamp(date = new Date()) {
  const local = new Date(date.getTime() - 3 * 3600000).toISOString();
  return `${local.slice(0, 10)}_${local.slice(11, 16).replace(':', '')}`;
}

function safeName(value) {
  return String(value || 'arquivo.xlsx').replace(/[^a-zA-Z0-9À-ÿ._ -]/g, '_').slice(0, 140);
}

function publicVersion(version) {
  return {
    id: version.id,
    dashboard: version.dashboard,
    originalFile: version.originalFile,
    uploadedAt: version.uploadedAt,
    user: version.user,
    sizeBytes: version.sizeBytes,
    hash: version.hash,
    previousVersion: version.previousVersion,
    status: version.status,
    restoredFrom: version.restoredFrom || null,
    comparisonId: version.comparisonId || null,
    comparisonSummary: version.comparisonSummary || null
  };
}

export class VersionService {
  constructor({ drive, github, dashboard, maxBytes }) {
    this.drive = drive;
    this.github = github;
    this.dashboard = dashboard;
    this.maxBytes = maxBytes;
  }

  async context() {
    const folders = await this.drive.ensureDashboardFolders(this.dashboard.id);
    const indexFile = await this.drive.find(folders.JSON, 'versions-index.json');
    const index = indexFile
      ? await this.drive.downloadJson(indexFile.id)
      : { dashboard: this.dashboard.id, currentVersion: null, versions: [] };
    return { folders, indexFile, index };
  }

  async saveIndex(context, index) {
    const saved = await this.drive.upsert(context.folders.JSON, 'versions-index.json', JSON_MIME, jsonBytes(index), { dashboard: this.dashboard.id, kind: 'version-index' });
    context.indexFile = saved;
    context.index = index;
    return saved;
  }

  async archiveVersion({ folders, id, buffer, normalized, metadata, comparison = null, initialStatus = 'publicada' }) {
    const stamp = fileStamp(new Date(metadata.uploadedAt));
    const base = `${this.dashboard.id}_${stamp}_${id}`;
    const properties = { dashboard: this.dashboard.id, version: id, status: initialStatus };
    const xlsx = await this.drive.upload({ parentId: folders.HISTORICO, name: `${base}.xlsx`, mimeType: XLSX_MIME, content: buffer, appProperties: properties });
    const data = await this.drive.upload({ parentId: folders.JSON, name: `${base}.json`, mimeType: JSON_MIME, content: jsonBytes(normalized), appProperties: { ...properties, kind: 'normalized' } });
    const meta = await this.drive.upload({ parentId: folders.JSON, name: `${base}.meta.json`, mimeType: JSON_MIME, content: jsonBytes(metadata), appProperties: { ...properties, kind: 'metadata' } });
    let comparisonFile = null;
    if (comparison) {
      comparisonFile = await this.drive.upload({ parentId: folders.COMPARACOES, name: `${base}.diff.json`, mimeType: JSON_MIME, content: jsonBytes(comparison), appProperties: { ...properties, kind: 'comparison' } });
    }
    return { xlsx, data, meta, comparison: comparisonFile };
  }

  async ensureBaseline(context, currentGitHub, user) {
    if (context.index.currentVersion) return context;
    const id = crypto.randomUUID();
    const file = { name: this.dashboard.github.path, type: XLSX_MIME };
    const normalized = await validateAndNormalize({ file, buffer: currentGitHub.buffer, dashboard: this.dashboard, maxBytes: this.maxBytes });
    const hash = await sha256(currentGitHub.buffer);
    const uploadedAt = fortalezaIso();
    const metadata = {
      id,
      dashboard: this.dashboard.id,
      originalFile: this.dashboard.github.path,
      uploadedAt,
      user,
      sizeBytes: currentGitHub.buffer.byteLength,
      hash,
      previousVersion: null,
      status: 'importada'
    };
    const files = await this.archiveVersion({ folders: context.folders, id, buffer: currentGitHub.buffer, normalized, metadata, initialStatus: 'importada' });
    const version = {
      ...metadata,
      xlsxFileId: files.xlsx.id,
      normalizedFileId: files.data.id,
      metadataFileId: files.meta.id,
      comparisonId: null
    };
    const index = { dashboard: this.dashboard.id, currentVersion: id, updatedAt: uploadedAt, versions: [version] };
    await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.xlsx', XLSX_MIME, currentGitHub.buffer, { dashboard: this.dashboard.id, version: id });
    await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.json', JSON_MIME, jsonBytes(normalized), { dashboard: this.dashboard.id, version: id });
    await this.saveIndex(context, index);
    return context;
  }

  async log(folders, entry) {
    try {
      const name = `${fileStamp()}_${entry.transactionId || crypto.randomUUID()}.json`;
      await this.drive.upload({ parentId: folders.LOGS, name, mimeType: JSON_MIME, content: jsonBytes(entry), appProperties: { dashboard: this.dashboard.id, status: entry.status || 'unknown' } });
    } catch (error) {
      console.error('Version log failed', error);
    }
  }

  async update({ file, buffer, user = 'operador', restoredFrom = null, allowDuplicate = false }) {
    const transactionId = crypto.randomUUID();
    const steps = ['arquivo_recebido'];
    const normalized = await validateAndNormalize({ file, buffer, dashboard: this.dashboard, maxBytes: this.maxBytes });
    steps.push('estrutura_validada');
    const hash = await sha256(buffer);
    const currentGitHub = await this.github.current(this.dashboard.github);
    const context = await this.context();
    await this.ensureBaseline(context, currentGitHub, user);
    steps.push('versao_anterior_localizada', 'backup_criado');
    if (!allowDuplicate && context.index.versions.some((version) => version.hash === hash)) {
      throw new AppError('Este arquivo já foi enviado anteriormente.', 409, 'DUPLICATE_FILE', { hash });
    }

    const previousVersion = context.index.versions.find((version) => version.id === context.index.currentVersion);
    const previousNormalized = previousVersion ? await this.drive.downloadJson(previousVersion.normalizedFileId) : null;
    const id = crypto.randomUUID();
    const uploadedAt = fortalezaIso();
    const metadata = {
      id,
      dashboard: this.dashboard.id,
      originalFile: safeName(file.name),
      uploadedAt,
      user,
      sizeBytes: buffer.byteLength,
      hash,
      previousVersion: previousVersion?.id || null,
      status: 'publicada',
      restoredFrom
    };
    const comparison = previousNormalized
      ? compareVersions(previousNormalized, normalized, { previousVersion: previousVersion.id, currentVersion: id })
      : firstVersionComparison(normalized, { currentVersion: id });
    const stageBase = `${this.dashboard.id}_${fileStamp(new Date(uploadedAt))}_${id}`;
    const stageProperties = { dashboard: this.dashboard.id, version: id, status: 'staged', transaction: transactionId };
    const staged = [];
    let published = null;
    try {
      const stagedXlsx = await this.drive.upload({ parentId: context.folders._TRANSACOES, name: `${stageBase}.xlsx`, mimeType: XLSX_MIME, content: buffer, appProperties: stageProperties });
      const stagedData = await this.drive.upload({ parentId: context.folders._TRANSACOES, name: `${stageBase}.json`, mimeType: JSON_MIME, content: jsonBytes(normalized), appProperties: { ...stageProperties, kind: 'normalized' } });
      const stagedDiff = await this.drive.upload({ parentId: context.folders._TRANSACOES, name: `${stageBase}.diff.json`, mimeType: JSON_MIME, content: jsonBytes(comparison), appProperties: { ...stageProperties, kind: 'comparison' } });
      const stagedMeta = await this.drive.upload({ parentId: context.folders._TRANSACOES, name: `${stageBase}.meta.json`, mimeType: JSON_MIME, content: jsonBytes(metadata), appProperties: { ...stageProperties, kind: 'metadata' } });
      staged.push(stagedXlsx, stagedData, stagedDiff, stagedMeta);
      steps.push('nova_versao_armazenada', 'comparacao_concluida');

      published = await this.github.update(this.dashboard.github, buffer, currentGitHub.sha, `Atualiza ${this.dashboard.label} · ${uploadedAt}`);
      const finalProperties = { dashboard: this.dashboard.id, version: id, status: 'published', transaction: transactionId };
      const finalXlsx = await this.drive.move(stagedXlsx.id, context.folders.HISTORICO, context.folders._TRANSACOES, finalProperties);
      const finalData = await this.drive.move(stagedData.id, context.folders.JSON, context.folders._TRANSACOES, { ...finalProperties, kind: 'normalized' });
      const finalDiff = await this.drive.move(stagedDiff.id, context.folders.COMPARACOES, context.folders._TRANSACOES, { ...finalProperties, kind: 'comparison' });
      const finalMeta = await this.drive.move(stagedMeta.id, context.folders.JSON, context.folders._TRANSACOES, { ...finalProperties, kind: 'metadata' });
      await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.xlsx', XLSX_MIME, buffer, { dashboard: this.dashboard.id, version: id });
      await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.json', JSON_MIME, jsonBytes(normalized), { dashboard: this.dashboard.id, version: id });
      const version = {
        ...metadata,
        xlsxFileId: finalXlsx.id,
        normalizedFileId: finalData.id,
        metadataFileId: finalMeta.id,
        comparisonId: finalDiff.id,
        comparisonSummary: comparison.summary,
        githubCommit: published.commit?.sha || null
      };
      const nextIndex = {
        dashboard: this.dashboard.id,
        currentVersion: id,
        updatedAt: uploadedAt,
        versions: [version, ...context.index.versions]
      };
      await this.saveIndex(context, nextIndex);
      steps.push('dashboard_atualizado');
      await this.log(context.folders, { transactionId, dashboard: this.dashboard.id, version: id, status: 'success', at: uploadedAt, hash, user, steps });
      return { ok: true, transactionId, version: publicVersion(version), comparison, steps };
    } catch (error) {
      if (published?.content?.sha) {
        try {
          await this.github.update(this.dashboard.github, currentGitHub.buffer, published.content.sha, `Rollback automático ${this.dashboard.label} · ${fortalezaIso()}`);
          if (previousNormalized) {
            await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.xlsx', XLSX_MIME, currentGitHub.buffer, { dashboard: this.dashboard.id, version: previousVersion.id });
            await this.drive.upsert(context.folders.BASE_ATUAL, 'base-atual.json', JSON_MIME, jsonBytes(previousNormalized), { dashboard: this.dashboard.id, version: previousVersion.id });
            await this.saveIndex(context, context.index);
          }
        } catch (rollbackError) {
          console.error('Critical rollback failure', rollbackError);
        }
      }
      await Promise.all(staged.map((item) => this.drive.setProperties(item.id, { ...stageProperties, status: 'failed' }).catch(() => null)));
      await this.log(context.folders, { transactionId, dashboard: this.dashboard.id, status: 'failed', at: fortalezaIso(), hash, user, error: error.code || 'INTERNAL_ERROR', steps });
      throw error;
    }
  }

  async versions() {
    const context = await this.context();
    return { dashboard: this.dashboard.id, currentVersion: context.index.currentVersion, updatedAt: context.index.updatedAt || null, versions: context.index.versions.map(publicVersion) };
  }

  async comparison(leftId, rightId) {
    const context = await this.context();
    const left = context.index.versions.find((version) => version.id === leftId);
    const right = context.index.versions.find((version) => version.id === rightId);
    if (!left || !right) throw new AppError('Uma das versões selecionadas não existe.', 404, 'VERSION_NOT_FOUND');
    return compareVersions(await this.drive.downloadJson(left.normalizedFileId), await this.drive.downloadJson(right.normalizedFileId), { previousVersion: left.id, currentVersion: right.id });
  }

  async currentComparison() {
    const context = await this.context();
    const current = context.index.versions.find((version) => version.id === context.index.currentVersion);
    if (!current) throw new AppError('Ainda não existe histórico para este dashboard.', 404, 'NO_HISTORY');
    if (current.comparisonId) return this.drive.downloadJson(current.comparisonId);
    const previous = context.index.versions.find((version) => version.id === current.previousVersion);
    if (!previous) return firstVersionComparison(await this.drive.downloadJson(current.normalizedFileId), { currentVersion: current.id });
    return this.comparison(previous.id, current.id);
  }

  async restore(versionId, user) {
    const context = await this.context();
    const version = context.index.versions.find((item) => item.id === versionId);
    if (!version) throw new AppError('Versão histórica não encontrada.', 404, 'VERSION_NOT_FOUND');
    const buffer = await this.drive.download(version.xlsxFileId);
    return this.update({ file: { name: `restauracao_${version.originalFile}`, type: XLSX_MIME }, buffer, user, restoredFrom: versionId, allowDuplicate: true });
  }
}
