import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnTracksLocation, normalizePosition, publicEquipmentId, validatePosition } from '../src/validation.js';

const valid = () => ({ equipmentId: 'NTC001', capturedAt: new Date().toISOString(), latitude: -14.01, longitude: -49.19, accuracyM: 6, batteryPct: 84 });

test('accepts the NTC001 pilot position', () => assert.equal(validatePosition(valid()), null));
test('rejects identifiers outside the registered fleet', () => assert.match(validatePosition({ ...valid(), equipmentId: 'NTC002' }), /Equipamento/));
test('rejects invalid coordinates', () => assert.match(validatePosition({ ...valid(), latitude: 100 }), /Latitude/));
test('publishes only registered identifiers', () => {
  assert.equal(publicEquipmentId('LOCO007'), 'LOCO007');
  assert.equal(publicEquipmentId('LOCO008'), null);
});
test('normalizes captured time and optional telemetry', () => {
  const normalized = normalizePosition(valid(), '2026-08-10T12:00:00.000Z');
  assert.equal(normalized.equipmentId, 'NTC001');
  assert.equal(normalized.speedMps, null);
  assert.equal(normalized.batteryPct, 84);
});
test('converts OwnTracks telemetry to the dashboard format', () => {
  const normalized = normalizeOwnTracksLocation({ tst: 1786363200, lat: -14.01, lon: -49.19, acc: 7, vel: 36, cog: 91, alt: 410, batt: 62 }, 'NTC001');
  assert.equal(normalized.equipmentId, 'NTC001');
  assert.equal(normalized.speedMps, 10);
  assert.equal(normalized.bearingDeg, 91);
  assert.equal(normalized.batteryPct, 62);
  assert.equal(validatePosition(normalized), null);
});
