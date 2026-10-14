import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/flagship/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const evaluate = (body = '', path = '/evaluate') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const selected = target => `false\nvalue:${target}\nvalue:STATIC\nabsent\nvalue:\ufeffowned\0猫\n`;
test('actual C++/Wasm boolean details distinguish false, fallback and absent/empty fields (mock provider)', async () => {
  const first = await evaluate(); assert.equal(first.status, 200); assert.equal(await first.text(), selected(''));
  const fallback = await evaluate('fallback'); assert.equal(fallback.status, 200);
  assert.equal(await fallback.text(), 'true\nabsent\nvalue:ERROR\nvalue:FLAG_NOT_FOUND\nvalue:\n');
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const target = `owned-${i}-猫😀`;
    const response = await evaluate(target); assert.equal(response.status, 200); assert.equal(await response.text(), selected(target));
  }));
  for (const target of ['t'.repeat(256), '\ufeffowned猫']) {
    const response = await evaluate(target); assert.equal(response.status, 200); assert.equal(await response.text(), selected(target));
  }
  const maximum = await evaluate('maximum'); assert.equal(maximum.status, 200);
  assert.equal(await maximum.text(), `true\nvalue:${'v'.repeat(256)}\nvalue:${'r'.repeat(64)}\nvalue:${'c'.repeat(64)}\nvalue:${'m'.repeat(4096)}\n`);
});
test('invalid inputs, provider/cleanup failures and deadlines do not fabricate fallback', async () => {
  for (const body of ['t'.repeat(257), '\0', new Uint8Array([255]), 'bad', 'throw', 'cleanup-fail']) {
    const response = await evaluate(body); assert.equal(response.status, 502); assert.equal(await response.text(), 'Flagship evaluation failed');
  }
  for (const path of ['/missing', '/short-timeout']) {
    const response = await evaluate('slow', path); assert.equal(response.status, 502); assert.equal(await response.text(), 'Flagship evaluation failed');
  }
  const recovery = await evaluate(); assert.equal(recovery.status, 200); assert.equal(await recovery.text(), selected(''));
});
test('production binding remains refused by default local harness', async () => {
  await assert.rejects(startLocalWorker('examples/flagship/wrangler.jsonc'), /Flagship requires explicit local seeding/);
});
