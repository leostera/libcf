import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/analytics-sql/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const query = (body = '', path = '/query') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const stats = 'elapsed_ms=0.5\nrows_read=10\nbytes_read=100\n';
const expected = label => `label=${label}\nempty=null\ndisabled=false\nenabled=true\nzero=-0\nfraction=0.25\n\n${stats}`;
const text = async response => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
test('C++/Wasm projects scalars and stats using explicit fake named/positional queries', async () => {
  for (const path of ['/query', '/positional']) {
    const response = await query('', path); assert.equal(response.status, 200); assert.equal(await text(response), expected('synthetic-猫'));
    for (const label of ['\ufeff猫\0😀"\\', 'x'.repeat(4096)]) {
      const response = await query(label, path); assert.equal(response.status, 200); assert.equal(await text(response), expected(label));
    }
  }
  const empty = await query('empty'); assert.equal(empty.status, 200); assert.equal(await text(empty), stats);
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const label = `synthetic-${i}`, response = await query(label); assert.equal(response.status, 200); assert.equal(await text(response), expected(label));
  }));
});
test('invalid input, provider/shape/cleanup/deadline failures stay errors, with recovery', async () => {
  for (const label of ['x'.repeat(4097), new Uint8Array([255]), 'throw', 'bad', 'unsafe', 'too-many', 'cleanup-fail']) {
    const response = await query(label); assert.equal(response.status, 502); assert.equal(await response.text(), 'Analytics SQL failed');
  }
  for (const [path, body] of [['/short-timeout', 'slow'], ['/missing', '']]) {
    const response = await query(body, path); assert.equal(response.status, 502); assert.equal(await response.text(), 'Analytics SQL failed');
  }
  const response = await query(); assert.equal(response.status, 200); await response.arrayBuffer();
});
test('ordinary harness rejects native account-scoped Analytics SQL', async () => {
  await assert.rejects(startLocalWorker('examples/analytics-sql/wrangler.jsonc'), /Analytics SQL queries account data remotely/);
});
