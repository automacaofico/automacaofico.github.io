import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/diff.js';

function version(records, duplicates = []) {
  return { dashboard: 'teste', duplicates, sheets: { Producao: records } };
}

test('detecta novos, removidos, alterações e status', () => {
  const previous = version([
    { key: 'A', values: { Producao: 10, Status: 'ABERTA' }, display: { Producao: 10, Status: 'Aberta' } },
    { key: 'B', values: { Producao: 5 }, display: { Producao: 5 } }
  ]);
  const current = version([
    { key: 'A', values: { Producao: 14, Status: 'BAIXADA' }, display: { Producao: 14, Status: 'Baixada' } },
    { key: 'C', values: { Producao: 2 }, display: { Producao: 2 } }
  ], [{ sheet: 'Producao', key: 'C', count: 2 }]);
  const diff = compareVersions(previous, current);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.changed, 1);
  assert.equal(diff.summary.statusChanges, 1);
  assert.equal(diff.summary.increases, 1);
  assert.equal(diff.summary.possibleDuplicates, 1);
});

test('mudança de ordem não altera registros', () => {
  const a = { key: 'A', values: { Valor: 1 }, display: { Valor: 1 } };
  const b = { key: 'B', values: { Valor: 2 }, display: { Valor: 2 } };
  const diff = compareVersions(version([a, b]), version([b, a]));
  assert.equal(diff.summary.totalChanges, 0);
  assert.equal(diff.summary.unchanged, 2);
});
