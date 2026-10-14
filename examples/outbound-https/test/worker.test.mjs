import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/outbound-https/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const get = (kind = 'mtls', body = '', mode = '') => fetch(`${worker.base}/${kind}${mode ? '?mock=' + mode : ''}`, {
  method: 'POST', body, headers: { authorization: 'must-not-forward', cookie: 'must-not-forward' }, signal: AbortSignal.timeout(10000),
});
const kinds = ['mtls', 'vpc-service', 'vpc-network'];
test('actual C++/Wasm role clients select only fixed mock endpoints and own bytes', async () => {
  for (const kind of kinds) {
    const response = await get(kind); assert.equal(response.status, 200); assert.equal(await response.text(), kind + ':health');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const binary = await get(kind, 'binary'); assert.equal(binary.status, 200); assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), new Uint8Array([0, 255, 128, 13, 10]));
    const empty = await get(kind, 'empty'); assert.equal(empty.status, 200); assert.equal((await empty.arrayBuffer()).byteLength, 0);
    const maximum = await get(kind, 'maximum'); assert.equal(maximum.status, 200); const bytes = new Uint8Array(await maximum.arrayBuffer()); assert.equal(bytes.length, 1048576); assert(bytes.every(value => value === 7));
    const selector = 'a'.repeat(64), selected = await get(kind, selector); assert.equal(selected.status, 200); assert.equal(await selected.text(), kind + ':' + selector);
  }
  await Promise.all(Array.from({ length: 9 }, async (_, i) => { const kind = kinds[i % 3], response = await get(kind); assert.equal(response.status, 200); assert.equal(await response.text(), kind + ':health'); }));
});
test('input/policy/provider/status/cleanup/deadline failures redact diagnostics and recover', async () => {
  for (const kind of kinds) {
    for (const name of ['unknown', 'a'.repeat(65), 'Upper', 'bad/name', 'bad\n', new Uint8Array([255]), 'oversized', 'redirect', 'error', 'fetch-fail', 'cleanup-fail', 'slow-fetch', 'slow-body', 'body-fail', 'bad-kind']) {
      const response = await get(kind, name); assert.equal(response.status, 502, kind + ':' + name); assert.equal(await response.text(), 'Outbound HTTPS GET failed');
    }
  }
  for (const mode of ['no-policy', 'wrong-role', 'missing-binding']) {
    const response = await get('mtls', 'health', mode); assert.equal(response.status, 502); assert.equal(await response.text(), 'Outbound HTTPS GET failed');
  }
  const response = await get(); assert.equal(response.status, 200); assert.equal(await response.text(), 'mtls:health');
});
test('native certificate/VPC declarations remain rejected before ordinary bundling', async () => {
  await assert.rejects(startLocalWorker('examples/outbound-https/wrangler.jsonc'), /mTLS and VPC require an owned certificate\/network and approval plan/);
});
