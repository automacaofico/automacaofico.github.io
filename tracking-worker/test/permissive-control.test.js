import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionContainedByConflicts, permissiveLinksMatch } from '../src/cco.js';

const conflict = { kind: 'CIRC', id: 'circ-1', km_start: 71500, km_end: 74500, start: '2026-08-11T12:00:00.000Z', end: '2026-08-11T16:00:00.000Z' };

test('permissive operation must remain inside the linked record', () => {
  assert.equal(permissionContainedByConflicts({ kmStart: 71500, kmEnd: 74500, start: conflict.start, end: conflict.end }, [conflict], Date.parse('2026-08-11T13:00:00.000Z')), true);
  assert.equal(permissionContainedByConflicts({ kmStart: 71000, kmEnd: 74500, start: conflict.start, end: conflict.end }, [conflict], Date.parse('2026-08-11T13:00:00.000Z')), false);
});

test('an overdue open record continues containing a permissive window', () => {
  assert.equal(permissionContainedByConflicts({ kmStart: 72000, kmEnd: 74000, start: '2026-08-11T17:00:00.000Z', end: '2026-08-11T18:00:00.000Z' }, [conflict], Date.parse('2026-08-11T17:00:00.000Z')), true);
});

test('controller must link every detected conflict and no unrelated record', () => {
  const conflicts = [conflict, { ...conflict, kind: 'LDL', id: 'ldl-1' }];
  assert.equal(permissiveLinksMatch(conflicts, ['CIRC:circ-1', 'LDL:ldl-1']), true);
  assert.equal(permissiveLinksMatch(conflicts, ['CIRC:circ-1']), false);
  assert.equal(permissiveLinksMatch(conflicts, ['CIRC:circ-1', 'LDL:ldl-1', 'LDL:ldl-2']), false);
});
