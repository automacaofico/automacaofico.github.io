import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardRange, iso, monthFrom, normalizeCirculationRange, validLdlWorkforce } from '../src/cco.js';

test('interprets CCO datetime-local values in Fortaleza time', () => {
  assert.equal(iso('2026-08-14T08:00'), '2026-08-14T11:00:00.000Z');
  assert.equal(iso('2026-08-14T18:00'), '2026-08-14T21:00:00.000Z');
});

test('preserves explicit ISO timestamps without applying the offset twice', () => {
  assert.equal(iso('2026-08-14T11:00:00.000Z'), '2026-08-14T11:00:00.000Z');
  assert.equal(iso('2026-08-14T08:00:00-03:00'), '2026-08-14T11:00:00.000Z');
});

test('uses the Fortaleza calendar month for monthly operational numbering', () => {
  assert.equal(monthFrom('2026-09-01T02:30:00.000Z'), '2026-08');
  assert.equal(monthFrom('2026-09-01T03:00:00.000Z'), '2026-09');
});

test('requires at least two people in every LDL', () => {
  assert.equal(validLdlWorkforce(1), false);
  assert.equal(validLdlWorkforce(2), true);
  assert.equal(validLdlWorkforce(2000), true);
  assert.equal(validLdlWorkforce(2001), false);
});

test('normalizes decreasing circulation endpoints for spatial checks', () => {
  assert.deepEqual(normalizeCirculationRange(28540, 26600, 'decrescente'), {
    ok: true,
    kmStart: 26600,
    kmEnd: 28540
  });
  assert.deepEqual(normalizeCirculationRange(73000, 61900, 'decrescente'), {
    ok: true,
    kmStart: 61900,
    kmEnd: 73000
  });
});

test('rejects endpoints contrary to circulation direction', () => {
  assert.equal(normalizeCirculationRange(61900, 73000, 'decrescente').ok, false);
  assert.equal(normalizeCirculationRange(73000, 61900, 'crescente').ok, false);
  assert.equal(normalizeCirculationRange(61900, 61900, 'manobra').ok, false);
});

test('keeps dashboard reads within the recent operational window', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const range = dashboardRange(null, null, now);
  assert.equal(range.from, '2026-08-27T12:00:00.000Z');
  assert.equal(range.to, '2026-09-03T12:00:00.000Z');
});

test('does not allow state requests to expand the dashboard history window', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const range = dashboardRange('2026-01-01T00:00:00.000Z', '2026-09-03T12:00:00.000Z', now);
  assert.equal(range.from, '2026-08-27T12:00:00.000Z');
  assert.equal(range.to, '2026-09-03T12:00:00.000Z');
});
