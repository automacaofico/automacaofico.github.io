import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGpsMovement } from '../src/motion.js';
import { analyzeProjectedTrack } from '../../rastreamento/operacao/motion.js';

const startedAt = Date.parse('2026-08-10T12:00:00.000Z');
const at = (index) => new Date(startedAt + index * 5_000).toISOString();
const latitudeForMeters = (meters) => -14 + meters / 111_320;

test('ignores GPS jitter inside the 30 metre stationary zone', () => {
  const rows = [0, 14, -18, 22, -9, 17].map((meters, index) => ({
    captured_at: at(index),
    latitude: latitudeForMeters(meters),
    longitude: -49,
    accuracy_m: 6,
    speed_mps: 0,
  }));
  const summary = summarizeGpsMovement(rows);
  assert.equal(summary.distanceM, 0);
  assert.equal(summary.movingS, 0);
  assert.equal(summary.stoppedS, 25);
});

test('requires two consecutive positions outside the stationary zone', () => {
  const rows = [0, 65, 4].map((meters, index) => ({
    captured_at: at(index),
    latitude: latitudeForMeters(meters),
    longitude: -49,
    accuracy_m: 5,
    speed_mps: 0,
  }));
  assert.equal(summarizeGpsMovement(rows).distanceM, 0);
});

test('keeps a sustained real movement', () => {
  const rows = [0, 35, 72].map((meters, index) => ({
    captured_at: at(index),
    latitude: latitudeForMeters(meters),
    longitude: -49,
    accuracy_m: 5,
    speed_mps: 7,
  }));
  const summary = summarizeGpsMovement(rows);
  assert.ok(summary.distanceM > 70 && summary.distanceM < 74);
  assert.equal(summary.movingS, 10);
  assert.equal(summary.stoppedS, 0);
});

test('rejects an impossible sustained GPS jump', () => {
  const rows = [0, 500, 1_000].map((meters, index) => ({
    captured_at: at(index),
    latitude: latitudeForMeters(meters),
    longitude: -49,
    accuracy_m: 5,
    speed_mps: 0,
  }));
  assert.equal(summarizeGpsMovement(rows).distanceM, 0);
});

test('projects the displayed path onto the railway and rejects poor precision', () => {
  const points = [
    { captured_at: at(0), accuracy_m: 5, projection: { stationM: 1000, distanceM: 12, coordinate: [-49, -14] } },
    { captured_at: at(1), accuracy_m: 80, projection: { stationM: 1300, distanceM: 280, coordinate: [-48.99, -13.99] } },
    { captured_at: at(2), accuracy_m: 5, projection: { stationM: 1035, distanceM: 9, coordinate: [-48.9997, -13.9997] } },
    { captured_at: at(3), accuracy_m: 5, projection: { stationM: 1070, distanceM: 8, coordinate: [-48.9994, -13.9994] } },
  ];
  const analysis = analyzeProjectedTrack(points);
  assert.equal(analysis.rejectedCount, 1);
  assert.equal(analysis.accepted.length, 2);
  assert.deepEqual(analysis.accepted[1].projection.coordinate, [-48.9994, -13.9994]);
  assert.equal(analysis.distanceM, 70);
});
