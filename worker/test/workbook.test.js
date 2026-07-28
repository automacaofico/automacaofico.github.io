import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARDS } from '../src/schemas.js';
import { validateAndNormalize } from '../src/workbook.js';
import { eapMapWorkbookBuffer, mapWorkbookBuffer, workbookBuffer } from './helpers.js';

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

test('usa exclusivamente ID original no mapa de pendências', async () => {
  const result = await validateAndNormalize({
    file: { name: 'Pendencias_FICO_Mapa.xlsx' },
    buffer: mapWorkbookBuffer({ blankAtlasIds: true }),
    dashboard: DASHBOARDS.mapa_pendencias,
    maxBytes: 10_000_000
  });
  assert.equal(result.summary.records, 2);
  assert.deepEqual(result.sheets.Pendências.map((record) => record.key), ['101', '102']);
});

test('aceita a EAP Banco de Dados como fonte do mapa de pendências', async () => {
  const result = await validateAndNormalize({
    file: { name: 'EAP - FICO - Entrga de Obras.xlsx' },
    buffer: eapMapWorkbookBuffer(),
    dashboard: DASHBOARDS.mapa_pendencias,
    maxBytes: 10_000_000
  });
  assert.equal(result.summary.records, 2);
  assert.deepEqual(result.sheets.Pendências.map((record) => record.key), ['2200', '2201']);
  assert.equal(result.sheets.Pendências[0].display.Descrição, 'Destruído');
  assert.equal(result.sheets.Pendências[0].display.Status, 'Aberta');
  assert.equal(result.sheets.Pendências[0].display.Especialidade, 'Reparos');
  assert.equal(result.sheets.Pendências[0].display['Responsável FICO'], 'Fiscal FICO');
  assert.equal(result.sheets.Pendências[0].display.Priorização, 'P1');
});
