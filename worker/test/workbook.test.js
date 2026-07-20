import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARDS } from '../src/schemas.js';
import { validateAndNormalize } from '../src/workbook.js';
import { workbookBuffer } from './helpers.js';

test('valida e normaliza planilha correta', async () => {
  const buffer = workbookBuffer();
  const result = await validateAndNormalize({
    file: { name: 'super.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    buffer,
    dashboard: DASHBOARDS.superestrutura,
    maxBytes: 10_000_000
  });
  assert.equal(result.dashboard, 'superestrutura');
  assert.ok(result.summary.records >= 3);
  assert.equal(result.sheets.MATERIAIS[0].key, 'TRILHO¦T');
});

test('rejeita extensão inválida', async () => {
  await assert.rejects(() => validateAndNormalize({ file: { name: 'macro.xlsm' }, buffer: workbookBuffer(), dashboard: DASHBOARDS.superestrutura, maxBytes: 10_000_000 }), { code: 'INVALID_EXTENSION' });
});

test('rejeita dashboard incompatível', async () => {
  await assert.rejects(() => validateAndNormalize({ file: { name: 'super.xlsx' }, buffer: workbookBuffer(), dashboard: DASHBOARDS.mapa_pendencias, maxBytes: 10_000_000 }), { code: 'WRONG_DASHBOARD' });
});
