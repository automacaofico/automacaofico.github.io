import test from 'node:test';
import assert from 'node:assert/strict';
import { foldText, normalizeDate, normalizeKm, normalizeNumber, stableKey } from '../src/normalization.js';

test('normaliza texto, números, datas e KM', () => {
  assert.equal(foldText('  Ápia   Engenharia '), 'APIA ENGENHARIA');
  assert.equal(normalizeNumber('1.234,50'), 1234.5);
  assert.equal(normalizeDate('18/07/2026'), '2026-07-18');
  assert.equal(normalizeKm('KM 79+700'), 79700);
  assert.equal(stableKey(['P1', 'Ápia', '79+700'], ['Pacote', 'Empresa', 'KM']), 'P1¦APIA¦79700');
});
