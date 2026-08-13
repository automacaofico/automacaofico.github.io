import test from 'node:test';
import assert from 'node:assert/strict';
import { radarTestables } from '../src/radar.js';

test('Radar valida múltiplos trechos dentro da extensão FICO', () => {
  const result = radarTestables.normalizeSegments([
    { kmStart: 71400, kmEnd: 73500 },
    { kmStart: 76000, kmEnd: 76500 }
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 2);
});

test('Radar rejeita trecho invertido ou fora da extensão', () => {
  assert.match(radarTestables.normalizeSegments([{ kmStart: 5000, kmEnd: 4000 }]).error, /Revise os trechos/);
  assert.match(radarTestables.normalizeSegments([{ kmStart: 0, kmEnd: 300000 }]).error, /Revise os trechos/);
});

test('Radar calcula estados temporais e tolerância de encerramento', () => {
  const at = Date.parse('2026-08-13T12:00:00Z');
  assert.equal(radarTestables.effectiveStatus({ status: 'scheduled', planned_start: '2026-08-13T13:00:00Z', planned_end: '2026-08-13T14:00:00Z' }, at), 'scheduled');
  assert.equal(radarTestables.effectiveStatus({ status: 'scheduled', planned_start: '2026-08-13T11:00:00Z', planned_end: '2026-08-13T14:00:00Z' }, at), 'active');
  assert.equal(radarTestables.effectiveStatus({ status: 'active', planned_start: '2026-08-13T09:00:00Z', planned_end: '2026-08-13T11:00:00Z' }, at), 'awaiting_definition');
});

test('Radar normaliza equipamentos e rejeita quantidade inválida', () => {
  assert.deepEqual(radarTestables.normalizeEquipment([{ type: 'Escavadeira', quantity: 2 }]).items, [{ type: 'Escavadeira', quantity: 2 }]);
  assert.match(radarTestables.normalizeEquipment([{ type: 'Guindaste', quantity: 0 }]).error, /Revise tipo/);
});

test('Radar aceita várias atividades e elimina duplicidades', () => {
  assert.deepEqual(radarTestables.normalizeActivities([
    { id: 'ACT-1', name: 'Terraplenagem' },
    { id: 'ACT-2', name: 'Drenagem' },
    { name: ' drenagem ' }
  ]).items, [
    { id: 'ACT-1', name: 'Terraplenagem' },
    { id: 'ACT-2', name: 'Drenagem' }
  ]);
});

test('Radar exige ao menos uma atividade válida', () => {
  assert.match(radarTestables.normalizeActivities([]).error, /1 a 12 atividades/);
  assert.match(radarTestables.normalizeActivities([{ name: 'x' }]).error, /ao menos 3 caracteres/);
});

test('Radar exige decisão explícita sobre necessidade de LDL', () => {
  assert.equal(radarTestables.normalizeLdlRequirement('required'), 'required');
  assert.equal(radarTestables.normalizeLdlRequirement('not_required'), 'not_required');
  assert.equal(radarTestables.normalizeLdlRequirement(''), null);
  assert.equal(radarTestables.normalizeLdlRequirement('talvez'), null);
});

test('Radar exige contratada para perfis empresariais e proíbe empresa em perfis FICO', () => {
  assert.equal(radarTestables.validUserCompany('company_admin', 'APIA'), true);
  assert.equal(radarTestables.validUserCompany('front_manager', null), false);
  assert.equal(radarTestables.validUserCompany('viewer', ''), false);
  assert.equal(radarTestables.validUserCompany('fico_admin', null), true);
  assert.equal(radarTestables.validUserCompany('fico_inspector', 'APIA'), false);
});
