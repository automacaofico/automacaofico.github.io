import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrganogramState } from '../src/organogram.js';

test('aceita a estrutura completa do organograma', () => {
  const state = { nodes: [], contratos: [], carros: [], governanca: [], subtitle: 'FICO' };
  const result = normalizeOrganogramState(state);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, state);
});

test('rejeita estruturas incompletas', () => {
  assert.match(normalizeOrganogramState({ nodes: [] }).error, /incompleta/i);
  assert.match(normalizeOrganogramState(null).error, /inválidos/i);
});

test('rejeita payload acima do limite', () => {
  const state = { nodes: [], contratos: [], carros: [], governanca: [], subtitle: 'x'.repeat(500_001) };
  assert.match(normalizeOrganogramState(state).error, /limite/i);
});
