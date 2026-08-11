import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function fakeDb() {
  const state = { deletes: [] };
  const totals = [12, 4, 2, 3, 1, 5];
  return {
    state,
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
      };
    },
    async batch(statements) {
      if (statements.every((statement) => statement.sql.startsWith('SELECT COUNT'))) {
        return totals.map((total) => ({ results: [{ total }] }));
      }
      state.deletes.push(...statements.map((statement) => statement.sql));
      return statements.map(() => ({ success: true }));
    },
  };
}

function request(password) {
  return new Request('https://example.test/api/v2/admin/history/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resetPassword: password }),
  });
}

test('history reset rejects the normal admin password', async () => {
  const DB = fakeDb();
  const response = await worker.fetch(request('admin-password'), {
    DB,
    OPERATOR_ADMIN_PASSWORD: 'admin-password',
    HISTORY_RESET_PASSWORD: 'Fico@2027',
  });
  assert.equal(response.status, 401);
  assert.equal(DB.state.deletes.length, 0);
});

test('history reset clears operational data and preserves registrations', async () => {
  const DB = fakeDb();
  const response = await worker.fetch(request('Fico@2027'), {
    DB,
    OPERATOR_ADMIN_PASSWORD: 'admin-password',
    HISTORY_RESET_PASSWORD: 'Fico@2027',
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.deleted, {
    positions: 12,
    positionSamples: 4,
    latestPositions: 2,
    sessions: 3,
    sessionSummaries: 1,
    operationalEvents: 5,
  });
  assert.deepEqual(DB.state.deletes, [
    'DELETE FROM operational_events',
    'DELETE FROM operation_session_summaries',
    'DELETE FROM position_samples',
    'DELETE FROM positions',
    'DELETE FROM latest_positions',
    'DELETE FROM operator_sessions',
  ]);
  assert.deepEqual(body.preserved, [
    'equipment',
    'operators',
    'personal_devices',
    'activation_codes',
    'requesters',
    'cco_controllers',
    'ldl',
    'circulations',
    'permissive_authorizations',
  ]);
});
