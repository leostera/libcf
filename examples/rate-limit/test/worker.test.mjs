import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/rate-limit/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const limit = (body, path = '/limit') => fetch(`${worker.base}${path}`, { method: 'POST', body });

test('typed outcomes distinguish allowed, exceeded and independent keys/namespaces', async () => {
  const key = randomUUID();
  assert.equal((await limit(key)).status, 200);
  assert.equal((await limit(key)).status, 200);
  assert.equal((await limit(key)).status, 429);
  assert.equal((await limit(randomUUID())).status, 200);
  assert.equal((await limit(key, '/other')).status, 200);
});

test('empty keys are supported; concurrent local calls share their namespace', async () => {
  assert.equal((await limit('')).status, 200);
  const key = randomUUID();
  const statuses = await Promise.all(Array.from({ length: 8 }, async () => (await limit(key)).status));
  assert.equal(statuses.filter(status => status === 200).length, 2);
  assert.equal(statuses.filter(status => status === 429).length, 6);
});

test('missing bindings and oversized keys fail without corrupting later calls', async () => {
  assert.equal((await limit('x', '/missing')).status, 502);
  assert.equal((await limit('x'.repeat(65537))).status, 502);
  assert.equal((await limit(randomUUID())).status, 200);
});
