import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/vectorize/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
function body(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return bytes;
}
const query = (values, path = '/query') => fetch(`${worker.base}${path}`, { method: 'POST', body: body(values) });

test('real C++/Wasm query dispatch against explicit mock preserves scores, Unicode and concurrency', async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const id = i + 1;
    const result = await query([id, 0, 0]);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), `query-${id}-猫\t${(id / 4).toFixed(6)}\n`);
  }));
  const empty = await query([0, 0, 0]);
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), '');
});

test('invalid input, malformed output, provider failure and local deadline fail; later call recovers', async () => {
  for (const values of [[NaN, 0, 0], [Infinity, 0, 0], [1, 0], [-1, 0, 0], [-2, 0, 0]]) {
    const result = await query(values);
    assert.equal(result.status, 502);
    assert.equal(await result.text(), 'Vectorize query failed');
  }
  const deadline = await query([9, 0, 0], '/short-timeout');
  assert.equal(deadline.status, 502);
  await deadline.text();
  const recovered = await query([4, 0, 0]);
  assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), 'query-4-猫\t1.000000\n');
});

test('production binding configuration cannot enable remote Vectorize in default tests', async () => {
  await assert.rejects(startLocalWorker('examples/vectorize/wrangler.jsonc'), /explicit local mock/);
});
