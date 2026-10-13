import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/analytics/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
test('C++ dispatches an analytics point into the local no-op binding', async () => {
  const response = await fetch(`${worker.base}/write`, { method: 'POST', body: 'local-index' });
  assert.equal(response.status, 202);
  assert.match(await response.text(), /not a persistence receipt/);
});
test('index limits and missing bindings fail with later recovery', async () => {
  assert.equal((await fetch(`${worker.base}/write`, { method: 'POST', body: 'x'.repeat(97) })).status, 502);
  assert.equal((await fetch(`${worker.base}/missing`, { method: 'POST', body: 'x' })).status, 502);
  assert.equal((await fetch(`${worker.base}/write`, { method: 'POST', body: 'ok' })).status, 202);
});
