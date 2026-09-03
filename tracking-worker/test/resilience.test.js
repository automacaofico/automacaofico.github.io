import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('readiness confirms the D1 binding and includes a request identifier', async () => {
  const response = await worker.fetch(new Request('https://example.test/ready'), {
    DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.database, 'ready');
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});

test('unexpected database failures return CORS-safe JSON instead of an opaque fetch failure', async () => {
  const response = await worker.fetch(new Request('https://automacaofico.github.io/ready', {
    headers: { origin: 'https://automacaofico.github.io' },
  }), {
    DB: { prepare: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) },
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://automacaofico.github.io');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});
