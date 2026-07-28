import { AppError } from './errors.js';
import { foldText, normalizeValue, stableKey } from './normalization.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function uniqueHeaders(row, overrides = {}) {
  const counts = new Map();
  return row.map((value, index) => {
    const base = String(overrides[index] ?? value ?? '').trim() || `COL_${index + 1}`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });
}

function makeRecord(sheet, key, raw, rowNumber) {
  const values = {};
  const display = {};
  for (const [field, value] of Object.entries(raw)) {
    values[field] = normalizeValue(value, field);
    display[field] = value instanceof Date ? value.toISOString() : value;
  }
  return { sheet, key, row: rowNumber, values, display };
}

function tableRecords(sheetName, rows, strategy) {
  const headerIndex = strategy.headerRow - 1;
  const headers = uniqueHeaders(rows[headerIndex] || [], strategy.columnOverrides);
  const foldedHeaders = new Map(headers.map((header) => [foldText(header), header]));
  const candidates = (column) => Array.isArray(column) ? column : [column];
  const resolved = (column) => candidates(column)
    .map((candidate) => foldedHeaders.get(foldText(candidate)))
    .filter(Boolean);
  const missing = strategy.requiredColumns.filter((column) => !resolved(column).length);
  if (missing.length) {
    const labels = missing.map((column) => candidates(column).join(' ou '));
    throw new AppError(`Colunas obrigatórias ausentes em “${sheetName}”: ${labels.join(', ')}.`, 422, 'MISSING_COLUMNS', { sheet: sheetName, missing: labels });
  }
  const keyFields = strategy.keys.map((column) => resolved(column));
  const records = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((value) => value !== null && value !== undefined && value !== '')) continue;
    const sourceRaw = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? null]));
    const keyValues = keyFields.map((fields) => fields
      .map((field) => sourceRaw[field])
      .find((value) => value !== null && value !== undefined && value !== '') ?? null);
    if (keyValues.every((value) => value === null || value === undefined || value === '')) continue;
    if (strategy.keyPattern && !strategy.keyPattern.test(String(keyValues[0]).trim())) continue;
    const raw = strategy.canonicalColumns
      ? Object.fromEntries(Object.entries(strategy.canonicalColumns).map(([canonical, aliases]) => {
        const fields = resolved(aliases);
        const value = fields
          .map((field) => sourceRaw[field])
          .find((candidate) => candidate !== null && candidate !== undefined && candidate !== '') ?? null;
        return [canonical, value];
      }))
      : sourceRaw;
    records.push(makeRecord(sheetName, stableKey(keyValues, strategy.keys.map((column) => candidates(column)[0])), raw, index + 1));
  }
  return records;
}

function matrixRecords(sheetName, rows, strategy) {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = Array.from({ length: maxColumns }, (_, column) => {
    const labels = strategy.headerRows
      .map((rowNumber) => rows[rowNumber - 1]?.[column])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(normalizeValue(value) ?? ''));
    return labels.length ? labels.join(' · ') : `COL_${column + 1}`;
  });
  const headerSet = new Set(strategy.headerRows.map((row) => row - 1));
  const seenLabels = new Map();
  const records = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (headerSet.has(index)) continue;
    const row = rows[index] || [];
    if (!row.some((value) => value !== null && value !== undefined && value !== '')) continue;
    const baseLabel = row[strategy.labelColumn] ?? `LINHA_${index + 1}`;
    const folded = foldText(baseLabel) || `LINHA_${index + 1}`;
    const occurrence = (seenLabels.get(folded) || 0) + 1;
    seenLabels.set(folded, occurrence);
    const raw = {};
    for (let column = 0; column < maxColumns; column += 1) {
      if (column === strategy.labelColumn) continue;
      const value = row[column];
      if (value === null || value === undefined || value === '') continue;
      raw[headers[column]] = value;
    }
    if (!Object.keys(raw).length) continue;
    records.push(makeRecord(sheetName, `${folded}¦${occurrence}`, raw, index + 1));
  }
  return records;
}

function duplicateKeys(records) {
  const counts = new Map();
  records.forEach((record) => counts.set(record.key, (counts.get(record.key) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

export async function readWorkbook(buffer) {
  let XLSX;
  try {
    XLSX = await import('xlsx');
  } catch {
    throw new AppError('Leitor Excel indisponível no servidor.', 500, 'XLSX_UNAVAILABLE');
  }
  try {
    return XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: false, cellStyles: false });
  } catch {
    throw new AppError('O arquivo Excel não pôde ser lido.', 422, 'INVALID_WORKBOOK');
  }
}

export async function validateAndNormalize({ file, buffer, dashboard, maxBytes }) {
  const name = String(file?.name || 'arquivo.xlsx');
  if (!/\.xlsx$/i.test(name)) throw new AppError('Envie somente arquivos .xlsx sem macros.', 415, 'INVALID_EXTENSION');
  if (!buffer?.byteLength) throw new AppError('O arquivo está vazio.', 422, 'EMPTY_FILE');
  if (buffer.byteLength > maxBytes) throw new AppError(`O arquivo excede ${Math.round(maxBytes / 1048576)} MB.`, 413, 'FILE_TOO_LARGE');
  const header = new Uint8Array(buffer.slice(0, 4));
  if (!(header[0] === 0x50 && header[1] === 0x4b)) throw new AppError('O conteúdo não corresponde a um arquivo XLSX.', 415, 'INVALID_MIME');
  if (file?.type && file.type !== XLSX_MIME && file.type !== 'application/octet-stream') {
    throw new AppError('O tipo MIME do arquivo não é permitido.', 415, 'INVALID_MIME');
  }

  const workbook = await readWorkbook(buffer);
  const foldedSheets = new Map(workbook.SheetNames.map((name) => [foldText(name), name]));
  const missingSheets = dashboard.requiredSheets.filter((name) => !foldedSheets.has(foldText(name)));
  const missingSheetGroups = (dashboard.requiredSheetGroups || [])
    .filter((group) => !group.some((name) => foldedSheets.has(foldText(name))));
  if (missingSheets.length || missingSheetGroups.length) {
    const alternatives = missingSheetGroups.map((group) => group.join(' ou '));
    const labels = [...missingSheets, ...alternatives];
    throw new AppError(`Arquivo incompatível com ${dashboard.label}. Abas ausentes: ${labels.join(', ')}.`, 422, 'WRONG_DASHBOARD', { missingSheets: labels });
  }

  const sheets = {};
  const duplicates = [];
  for (const [expectedName, strategy] of Object.entries(dashboard.sheets)) {
    const actualName = (strategy.sourceNames || [expectedName])
      .map((name) => foldedSheets.get(foldText(name)))
      .find(Boolean);
    if (!actualName) continue;
    const effectiveStrategy = {
      ...strategy,
      headerRow: strategy.headerRowBySource?.[foldText(actualName)] || strategy.headerRow
    };
    const rows = workbook.Sheets[actualName]
      ? (await import('xlsx')).utils.sheet_to_json(workbook.Sheets[actualName], { header: 1, raw: true, defval: null, blankrows: true })
      : [];
    const records = effectiveStrategy.type === 'table'
      ? tableRecords(expectedName, rows, effectiveStrategy)
      : matrixRecords(expectedName, rows, effectiveStrategy);
    sheets[expectedName] = records;
    duplicateKeys(records).forEach((duplicate) => duplicates.push({ sheet: expectedName, ...duplicate }));
  }
  const recordCount = Object.values(sheets).reduce((total, records) => total + records.length, 0);
  if (!recordCount) throw new AppError('Nenhum dado válido foi encontrado.', 422, 'NO_DATA');
  return {
    dashboard: dashboard.id,
    generatedAt: new Date().toISOString(),
    source: { name, size: buffer.byteLength, sheets: workbook.SheetNames },
    summary: { sheets: Object.keys(sheets).length, records: recordCount, possibleDuplicates: duplicates.length },
    duplicates,
    sheets
  };
}
