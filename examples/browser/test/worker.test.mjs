import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
import { png } from '../../images/test/fixtures.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/browser/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const screenshot = (body, path = '/screenshot') => fetch(`${worker.base}${path}`, { method: 'POST', body });

test('C++/Wasm screenshot boundary handles concurrent explicit mocks and UTF-8 endpoints', async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const response = await screenshot(`\ufeff<p>owned-${i}-猫😀\0</p>`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(png));
  }));
  const maximum = await screenshot('x'.repeat(65536));
  assert.equal(maximum.status, 200);
  assert.deepEqual(new Uint8Array(await maximum.arrayBuffer()), new Uint8Array(png));
  // Transport-size fixture only: padding after the PNG does not prove decoding.
  const full = await screenshot('max-output');
  assert.equal(full.status, 200);
  const bytes = new Uint8Array(await full.arrayBuffer());
  assert.equal(bytes.length, 1048576);
  assert.deepEqual(bytes.slice(0, png.length), new Uint8Array(png));
  assert(bytes.subarray(png.length).every(byte => byte === 0));
});

test('input/output rejection, missing binding, failure and timeout preserve recovery', async () => {
  for (const body of ['', 'x'.repeat(65537), new Uint8Array([255]), 'fail', 'bad-status', 'bad-mime', 'bad-signature', 'oversized']) {
    const response = await screenshot(body);
    assert.equal(response.status, 502); assert.equal(await response.text(), 'Browser screenshot failed');
  }
  for (const path of ['/missing', '/invalid-size', '/short-timeout']) {
    const response = await screenshot(path === '/short-timeout' ? 'slow' : '<p>owned</p>', path);
    assert.equal(response.status, 502); assert.equal(await response.text(), 'Browser screenshot failed');
  }
  const recovered = await screenshot('<p>recovered</p>');
  assert.equal(recovered.status, 200);
  assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()), new Uint8Array(png));
});

test('default local harness refuses the production browser config before bundling', async () => {
  await assert.rejects(startLocalWorker('examples/browser/wrangler.jsonc'), /explicit local mock/);
});
