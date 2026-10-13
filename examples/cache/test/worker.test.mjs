import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let base;
before(async () => { worker = await startLocalWorker('examples/cache/wrangler.jsonc'); base = worker.base; });
after(async () => { await worker?.dispose(); });

test('cache match/put/delete preserve binary body and headers', async () => {
  const url = `${base}/entries/${randomUUID()}`;
  assert.equal((await fetch(url)).status, 404);
  const body = Uint8Array.of(0, 128, 255, 65);
  assert.equal((await fetch(url, { method: 'PUT', body })).status, 201);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-origin'), 'cf');
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  assert.equal(await (await fetch(url, { method: 'DELETE' })).text(), 'deleted');
  assert.equal(await (await fetch(url, { method: 'DELETE' })).text(), 'absent');
  assert.equal((await fetch(url)).status, 404);
});

test('named caches are isolated from the default cache', async () => {
  const url = `${base}/entries/${randomUUID()}`;
  const headers = { 'x-cache-name': 'libcf-named-test' };
  assert.equal((await fetch(url, { method: 'PUT', body: 'named', headers })).status, 201);
  assert.equal((await fetch(url)).status, 404);
  assert.equal(await (await fetch(url, { headers })).text(), 'named');
  await fetch(url, { method: 'DELETE', headers });
});

test('cached empty body is distinct from a miss', async () => {
  const url = `${base}/entries/${randomUUID()}`;
  assert.equal((await fetch(url, { method: 'PUT', body: '' })).status, 201);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  await fetch(url, { method: 'DELETE' });
});
