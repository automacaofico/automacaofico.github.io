import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComposition } from '../src/cco.js';

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
