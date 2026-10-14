import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/artifacts/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const info = (body = '', path = '/info') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const expected = name => `\ufeffid\0猫\n${name}\nmain\nwritable\n`;
test('actual C++/Wasm projects owned metadata from explicit fake repositories', async () => {
  const response = await info(); assert.equal(response.status, 200);
  // Response.text strips a leading UTF-8 BOM, so inspect the actual bytes.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  assert.equal(decoder.decode(await response.arrayBuffer()), expected('libcf-owned-repo'));
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const name = `owned-${i}.git`, response = await info(name);
    assert.equal(response.status, 200); assert.equal(decoder.decode(await response.arrayBuffer()), expected(name));
  }));
  const name = 'n'.repeat(128), maximum = await info(name); assert.equal(maximum.status, 200);
  assert.equal(await maximum.text(), `${'i'.repeat(128)}\n${name}\n${'b'.repeat(256)}\nread-only\n`);
});
test('invalid input, lookup failure, malformed data, cleanup and both deadlines recover', async () => {
  for (const name of ['n'.repeat(129), '..', 'bad/name', 'bad\n', new Uint8Array([255]), 'not-found', 'bad', 'cleanup-fail']) {
    const response = await info(name); assert.equal(response.status, 502); assert.equal(await response.text(), 'Artifacts metadata failed');
  }
  for (const name of ['lookup-slow', 'read-slow']) {
    const response = await info(name, '/short-timeout'); assert.equal(response.status, 502); assert.equal(await response.text(), 'Artifacts metadata failed');
  }
  const missing = await info('', '/missing'); assert.equal(missing.status, 502); await missing.arrayBuffer();
  const recovery = await info(); assert.equal(recovery.status, 200); await recovery.arrayBuffer();
});
test('ordinary harness refuses the native Artifacts declaration', async () => {
  await assert.rejects(startLocalWorker('examples/artifacts/wrangler.jsonc'), /Artifacts uses a remote service/);
});
