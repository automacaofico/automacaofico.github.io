import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function fakeDb() {
  const state = {
    equipment: [{ id: 'LOCO001', name: 'Locomotiva 001', type: 'locomotiva', description: null, active: 1 }],
  };
  return {
    state,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() { return { results: state.equipment }; },
        async run() {
          if (!sql.startsWith('UPDATE equipment')) return { meta: { changes: 0 } };
          const [name, description, id] = this.values;
          const equipment = state.equipment.find((item) => item.id === id);
          if (!equipment) return { meta: { changes: 0 } };
          equipment.name = name;
          equipment.description = description;
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

function request(path, body) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('equipment administration requires the administrative password', async () => {
  const response = await worker.fetch(
    request('/api/v2/admin/equipment/list', { adminPassword: 'wrong' }),
    { DB: fakeDb(), OPERATOR_ADMIN_PASSWORD: 'correct' },
  );
  assert.equal(response.status, 401);
});

test('equipment administration updates name and description', async () => {
  const DB = fakeDb();
  const response = await worker.fetch(
    request('/api/v2/admin/equipment/update', {
      adminPassword: 'correct',
      equipmentId: 'LOCO001',
      name: 'Locomotiva Azul 001',
      description: 'GE Transportation · patrimônio 4501',
    }),
    { DB, OPERATOR_ADMIN_PASSWORD: 'correct' },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.equipment.name, 'Locomotiva Azul 001');
  assert.equal(DB.state.equipment[0].description, 'GE Transportation · patrimônio 4501');
});
