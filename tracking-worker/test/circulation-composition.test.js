import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComposition, normalizeEquipmentMembers } from '../src/cco.js';

test('accepts mixed wagon types with loaded and empty groups', () => {
  const result = normalizeComposition([
    { wagonType: 'HNS', wagonCount: 5, loadStatus: 'loaded', cargoDescription: 'Brita' },
    { wagonType: 'HNS', wagonCount: 15, loadStatus: 'empty' },
    { wagonType: 'PET', wagonCount: 8, loadStatus: 'loaded', cargoDescription: 'Trilhos' },
    { wagonType: 'PET', wagonCount: 2, loadStatus: 'empty' }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.reduce((sum, item) => sum + item.wagonCount, 0), 30);
  assert.equal(result.items[1].cargoDescription, '');
});

test('accepts an empty consist as an unladen locomotive movement', () => {
  assert.deepEqual(normalizeComposition([]), { ok: true, items: [] });
});

test('requires cargo description for every loaded group', () => {
  const result = normalizeComposition([{ wagonType: 'PNT', wagonCount: 10, loadStatus: 'loaded', cargoDescription: '' }]);
  assert.equal(result.ok, false);
});

test('rejects unsupported wagon types', () => {
  const result = normalizeComposition([{ wagonType: 'XYZ', wagonCount: 10, loadStatus: 'empty' }]);
  assert.equal(result.ok, false);
});

test('accepts a socadora as commander with a towed regulator', () => {
  const result = normalizeEquipmentMembers([{ equipmentId: 'EGPR001', operationalRole: 'towed' }], 'EGPS001');
  assert.deepEqual(result, { ok: true, items: [{ equipmentId: 'EGPR001', operationalRole: 'towed' }] });
});

test('accepts locomotive, socadora and regulator in one formation', () => {
  const result = normalizeEquipmentMembers([
    { equipmentId: 'LOCO002', operationalRole: 'traction_auxiliary' },
    { equipmentId: 'EGPS001', operationalRole: 'towed' },
    { equipmentId: 'EGPR001', operationalRole: 'towed' }
  ], 'LOCO001');
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 3);
});

test('rejects commander duplication and repeated coupled equipment', () => {
  assert.equal(normalizeEquipmentMembers([{ equipmentId: 'EGPS001', operationalRole: 'towed' }], 'EGPS001').ok, false);
  assert.equal(normalizeEquipmentMembers([
    { equipmentId: 'EGPR001', operationalRole: 'towed' },
    { equipmentId: 'EGPR001', operationalRole: 'towed' }
  ], 'EGPS001').ok, false);
});
