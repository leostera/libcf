import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let native, mock, id;
before(async () => {
  native = await startLocalWorker('examples/stream/test/local.wrangler.jsonc');
  mock = await startLocalWorker('examples/stream/test/mock.wrangler.jsonc');
});
after(async () => {
  try {
    if (id && native) { const response = await fetch(`${native.base}/__remove`, { method: 'POST', body: id }); await response.text(); }
  } finally { try { await native?.dispose(); } finally { await mock?.dispose(); } }
});
const details = (worker, body, path = '/details') => fetch(`${worker.base}${path}`, { method: 'POST', body });

test('C++/Wasm reads real local Stream metadata, preserves concurrent results and observes deletion', async () => {
  const initial = await fetch(`${native.base}/videos`); assert.equal(initial.status, 200); assert.equal(await initial.text(), '');
  const created = await fetch(`${native.base}/__fixture`, { method: 'POST' }); assert.equal(created.status, 200);
  id = (await created.json()).id;
  const expected = `${id}\tready\ttrue\t448\tunknown\n`;
  await Promise.all(Array.from({ length: 8 }, async () => {
    const result = await details(native, id); assert.equal(result.status, 200); assert.equal(await result.text(), expected);
  }));
  const listed = await fetch(`${native.base}/videos`); assert.equal(listed.status, 200); assert.equal(await listed.text(), expected);
  const removed = await fetch(`${native.base}/__remove`, { method: 'POST', body: id });
  assert.equal(removed.status, 200); await removed.text();
  const missing = await details(native, id); assert.equal(missing.status, 502); await missing.text();
  id = undefined;
  const afterDelete = await fetch(`${native.base}/videos`); assert.equal(afterDelete.status, 200); assert.equal(await afterDelete.text(), '');
});

test('explicit error mock covers malformed results, deadline and recovery; IDs fail before dispatch', async () => {
  for (const value of ['', 'x'.repeat(129), 'bad/id', '猫', 'fail', 'mismatch', 'bad-state', 'bad-size', 'bad-duration']) {
    const result = await details(mock, value); assert.equal(result.status, 502); assert.equal(await result.text(), 'Stream metadata failed');
  }
  const timeout = await details(mock, 'slow', '/short-timeout'); assert.equal(timeout.status, 502); await timeout.text();
  const recovered = await details(mock, 'recovered'); assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), 'recovered\tready\ttrue\t448\t0.125000\n');
});
