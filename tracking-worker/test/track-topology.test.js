import test from 'node:test';
import assert from 'node:assert/strict';
import { lineRangeAvailable } from '../src/cco.js';

test('line 01 is available throughout the trunk', () => {
  assert.equal(lineRangeAvailable('line01', 0, 292260), true);
});

test('line 02 is available inside yards and current DTOs', () => {
  assert.equal(lineRangeAvailable('line02', 4000, 6500), true);
  assert.equal(lineRangeAvailable('line02', 110700, 112700), true);
});

test('line 02 is rejected in single track and across topology limits', () => {
  assert.equal(lineRangeAvailable('line02', 7000, 8000), false);
  assert.equal(lineRangeAvailable('line02', 19700, 20200), false);
  assert.equal(lineRangeAvailable('line02', 19000, 20500), false);
  assert.equal(lineRangeAvailable('line02', 131260, 132000), false);
});

test('special tracks are available only inside their unifilar limits', () => {
  assert.equal(lineRangeAvailable('south_loop', 0, 2734), true);
  assert.equal(lineRangeAvailable('line_egp', 5520, 6084), true);
  assert.equal(lineRangeAvailable('welding_yard', 6100, 6500), true);
  assert.equal(lineRangeAvailable('line_egp', 5500, 6084), false);
  assert.equal(lineRangeAvailable('welding_yard', 6099, 6600), false);
});

test('unknown operational lines are rejected', () => {
  assert.equal(lineRangeAvailable('unknown', 0, 100), false);
});
