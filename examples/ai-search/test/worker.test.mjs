import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/ai-search/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const query = (body, path = '/search') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const expected = text => `id-${text}-猫\t0.750000\tdocs/猫\ttext-${text}\u0000owned\n`;

test('C++/Wasm keyword query owns Unicode/NUL results and handles concurrent explicit mocks', async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const text = `query-${i}-猫`;
    const result = await query(text);
    assert.equal(result.status, 200); assert.equal(await result.text(), expected(text));
  }));
  const bom = await query('\ufeffquery');
  assert.equal(bom.status, 200); assert.equal(await bom.text(), expected('\ufeffquery'));
  for (const body of ['empty', 'x'.repeat(4096)]) {
    const empty = await query(body);
    assert.equal(empty.status, 200); assert.equal(await empty.text(), '');
  }
});

test('input/output rejection, provider failure and deadline do not poison subsequent calls', async () => {
  for (const body of ['', 'x'.repeat(4097), new Uint8Array([255]), 'fail', 'bad-score', 'image', 'oversized']) {
    const result = await query(body);
    assert.equal(result.status, 502); assert.equal(await result.text(), 'AI Search query failed');
  }
  const timeout = await query('slow', '/short-timeout');
  assert.equal(timeout.status, 502); await timeout.text();
  const recovered = await query('recovered');
  assert.equal(recovered.status, 200); assert.equal(await recovered.text(), expected('recovered'));
});

test('default local harness refuses the production AI Search configuration', async () => {
  await assert.rejects(startLocalWorker('examples/ai-search/wrangler.jsonc'), /explicit local mock/);
});
