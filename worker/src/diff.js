import { fieldKind, foldText } from './normalization.js';

function sameValue(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  return left === right;
}

function classifyField(field, previous, current, previousDisplay, currentDisplay) {
  const kind = fieldKind(field);
  if (kind === 'status') return 'mudanca_status';
  if (typeof previous === 'number' && typeof current === 'number') {
    if (current > previous) return 'aumento';
    if (current < previous) return 'reducao';
  }
  if (kind === 'administrative' || foldText(previousDisplay) === foldText(currentDisplay)) return 'correcao_administrativa';
  return 'alteracao_negocio';
}

function indexes(normalized) {
  const output = new Map();
  for (const [sheet, records] of Object.entries(normalized?.sheets || {})) {
    output.set(sheet, new Map(records.map((record) => [record.key, record])));
  }
  return output;
}

export function compareVersions(previous, current, metadata = {}) {
  const previousIndex = indexes(previous);
  const currentIndex = indexes(current);
  const sheets = new Set([...previousIndex.keys(), ...currentIndex.keys()]);
  const changes = [];
  let unchanged = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  let statusChanges = 0;
  let increases = 0;
  let reductions = 0;
  let administrative = 0;

  for (const sheet of sheets) {
    const before = previousIndex.get(sheet) || new Map();
    const after = currentIndex.get(sheet) || new Map();
    const keys = new Set([...before.keys(), ...after.keys()]);
    for (const key of keys) {
      const oldRecord = before.get(key);
      const newRecord = after.get(key);
      if (!oldRecord) {
        added += 1;
        changes.push({ key, type: 'registro_novo', sheet, current: newRecord.display, fields: [] });
        continue;
      }
      if (!newRecord) {
        removed += 1;
        changes.push({ key, type: 'registro_removido', sheet, previous: oldRecord.display, fields: [] });
        continue;
      }
      const fields = new Set([...Object.keys(oldRecord.values), ...Object.keys(newRecord.values)]);
      const fieldChanges = [];
      for (const field of fields) {
        const oldValue = oldRecord.values[field] ?? null;
        const newValue = newRecord.values[field] ?? null;
        if (sameValue(oldValue, newValue)) continue;
        const classification = classifyField(field, oldValue, newValue, oldRecord.display[field], newRecord.display[field]);
        if (classification === 'mudanca_status') statusChanges += 1;
        if (classification === 'aumento') increases += 1;
        if (classification === 'reducao') reductions += 1;
        if (classification === 'correcao_administrativa') administrative += 1;
        fieldChanges.push({
          field,
          previous: oldRecord.display[field] ?? null,
          current: newRecord.display[field] ?? null,
          variation: typeof oldValue === 'number' && typeof newValue === 'number' ? newValue - oldValue : null,
          classification,
          scope: fieldKind(field)
        });
      }
      if (!fieldChanges.length) {
        unchanged += 1;
        continue;
      }
      changed += 1;
      changes.push({ key, type: 'registro_alterado', sheet, fields: fieldChanges });
    }
  }

  const duplicateChanges = (current?.duplicates || []).map((duplicate) => ({
    key: duplicate.key,
    type: 'possivel_duplicidade',
    sheet: duplicate.sheet,
    count: duplicate.count,
    fields: []
  }));
  changes.push(...duplicateChanges);

  return {
    dashboard: current.dashboard,
    previousVersion: metadata.previousVersion || null,
    currentVersion: metadata.currentVersion || null,
    comparedAt: new Date().toISOString(),
    summary: {
      totalChanges: added + removed + changed + duplicateChanges.length,
      added,
      removed,
      changed,
      unchanged,
      statusChanges,
      increases,
      reductions,
      administrativeCorrections: administrative,
      possibleDuplicates: duplicateChanges.length
    },
    changes
  };
}

export function firstVersionComparison(current, metadata = {}) {
  return {
    dashboard: current.dashboard,
    previousVersion: null,
    currentVersion: metadata.currentVersion || null,
    comparedAt: new Date().toISOString(),
    firstVersion: true,
    summary: {
      totalChanges: 0,
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: current.summary.records,
      statusChanges: 0,
      increases: 0,
      reductions: 0,
      administrativeCorrections: 0,
      possibleDuplicates: current.summary.possibleDuplicates
    },
    changes: []
  };
}
