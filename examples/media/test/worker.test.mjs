import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
import { png } from './fixture.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/media/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const frame = (body, path = '/frame') => fetch(`${worker.base}${path}`, { method: 'POST', body });

test('C++/Wasm frame dispatch returns owned binary output through an explicit provider mock', async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const result = await frame(new Uint8Array([i, 0, 128, 255]));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), png);
  }));
  const full = await frame(new Uint8Array(1048576));
  assert.equal(full.status, 200);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), png);
});

test('bounds, absent binding, wrong MIME, provider error and deadline reject; next call recovers', async () => {
  for (const [body, path] of [[new Uint8Array(), '/frame'], [new Uint8Array([1]), '/missing'],
    [new Uint8Array([1]), '/oversized'], [new Uint8Array([1]), '/invalid-size'],
    [new Uint8Array([255]), '/frame'], [new Uint8Array([253]), '/frame'], [new Uint8Array([254]), '/short-timeout']]) {
    const result = await frame(body, path);
    assert.equal(result.status, 502);
    assert.equal(await result.text(), 'Media frame failed');
  }
  const recovered = await frame(new Uint8Array([1]));
  assert.equal(recovered.status, 200);
  assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()), png);
});

test('production Media configuration is refused locally, with no remote fallback', async () => {
  await assert.rejects(startLocalWorker('examples/media/wrangler.jsonc'), /explicit local mock/);
});
