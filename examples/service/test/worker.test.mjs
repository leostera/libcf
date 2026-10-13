import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let base;
before(async () => {
  worker = await startLocalWorker('examples/service/wrangler.jsonc', '/', ['examples/service/upstream/wrangler.jsonc']);
  base = worker.base;
});
after(async () => { await worker?.dispose(); });

test('C++ service binding forwards method, headers and binary body to a local Worker', async () => {
  const body = Uint8Array.of(0, 255, 128, 65);
  const response = await fetch(`${base}/echo`, { method: 'POST', body, headers: { 'x-original': 'preserved' } });
  if (response.status !== 201) assert.fail(await response.text());
  assert.equal(response.headers.get('x-caller'), 'cpp');
  assert.equal(response.headers.get('x-method'), 'POST');
  assert.equal(response.headers.get('x-forwarded'), 'preserved');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
});

test('upstream errors remain HTTP responses rather than transport failures', async () => {
  const response = await fetch(`${base}/fail`);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'upstream unavailable');
});

test('204 response remains bodyless through Wasm', async () => {
  const response = await fetch(`${base}/empty`);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});

test('missing binding becomes a C++ Result error', async () => {
  const response = await fetch(`${base}/missing-binding`);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'service call failed');
});
