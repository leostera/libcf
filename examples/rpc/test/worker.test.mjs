import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalWorker } from '../../test/local-worker.mjs';
const config = 'examples/rpc/wrangler.jsonc';
const additionalConfigs = ['examples/rpc/reference/wrangler.jsonc'];

test('C++ RPC calls preserve JSON values across a real service binding', async () => {
  const worker = await startLocalWorker(config, { additionalConfigs });
  try {
    for (const value of [null, true, 1.25, '☁', { nested: [null, 'owned', 42] }]) {
      const response = await fetch(`${worker.base}/echo`, { method: 'POST', body: JSON.stringify([value]) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), value);
    }
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${worker.base}/sum`)));
    for (const response of responses) { assert.equal(response.status, 200); assert.equal(await response.text(), '42'); }
  } finally { await worker.dispose(); }
});

test('C++ RPC rejects invalid/unsupported values and provider failures, then recovers', async () => {
  const worker = await startLocalWorker(config, { additionalConfigs });
  try {
    for (const path of ['/failure', '/capability', '/large', '/reserved', '/missing']) {
      const response = await fetch(worker.base + path);
      assert.equal(response.status, 502, path);
      assert.equal(await response.text(), 'RPC failed');
    }
    for (const body of ['{}', 'invalid', JSON.stringify(Array(33).fill(null))]) {
      const response = await fetch(`${worker.base}/echo`, { method: 'POST', body });
      assert.equal(response.status, 502); await response.arrayBuffer();
    }
    const recovery = await fetch(`${worker.base}/sum`);
    assert.equal(recovery.status, 200); assert.equal(await recovery.text(), '42');
  } finally { await worker.dispose(); }
});
