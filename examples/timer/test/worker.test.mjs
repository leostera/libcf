import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/timer/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
test('sleep yields and concurrent C++ invocations preserve their owned URLs', async () => {
  await Promise.all(Array.from({ length: 12 }, async (_, id) => {
    const url = `${worker.base}/${id % 2 ? 'zero' : 'sleep'}?id=${id}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), url);
  }));
});
test('negative and excessive delays fail without preventing later sleeps', async () => {
  for (const path of ['/negative', '/oversized']) {
    const response = await fetch(`${worker.base}${path}`);
    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'sleep failed');
  }
  const response = await fetch(`${worker.base}/sleep`);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
});
