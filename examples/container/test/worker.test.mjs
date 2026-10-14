import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let mock, missing, reserved;
before(async () => {
  mock = await startLocalWorker('examples/container/test/local.wrangler.jsonc');
  missing = await startLocalWorker('examples/container/test/missing.wrangler.jsonc');
  reserved = await startLocalWorker('examples/container/test/reserved.wrangler.jsonc');
});
after(async () => { await Promise.all([mock?.dispose(), missing?.dispose(), reserved?.dispose()]); });
const inspect = (worker, path) => fetch(`${worker.base}${path}`);
const success = 'image=\ufeffimage\0猫\nlabels=2\nowner\tlibcf\nempty\t\n';

test('actual C++ DO adapter uses the explicitly fake borrowed capability and owns nullable metadata', async () => {
  const direct = await (await mock.durableStub('OBJECTS', 'libcf-inspect/success')).fetch('https://example.test/success');
  assert.equal(await direct.text(), success);
  await Promise.all(Array.from({ length: 8 }, async () => {
    const response = await inspect(mock, '/success'); assert.equal(response.status, 200); assert.equal(await response.text(), success);
  }));
  const none = await inspect(mock, '/none'); assert.equal(none.status, 200); assert.equal(await none.text(), 'no running container info');
  const starting = await inspect(mock, '/starting'); assert.equal(starting.status, 200); assert.equal(await starting.text(), 'image=\nlabels=0\n');
  const maximum = await inspect(mock, '/maximum'); assert.equal(maximum.status, 200);
  assert.equal(await maximum.text(), `image=${'i'.repeat(2048)}\nlabels=10\n` +
    Array.from({ length: 10 }, (_, i) => `${'k'.repeat(15)}${i}\t${'v'.repeat(64)}\n`).join(''));
  await Promise.all(Object.entries({ '/success': success, '/none': 'no running container info', '/starting': 'image=\nlabels=0\n' })
    .map(async ([path, expected]) => { const response = await inspect(mock, path); assert.equal(response.status, 200); assert.equal(await response.text(), expected); }));
});

test('malformed metadata, deadline, invalid timeout and cleanup failure preserve recovery', async () => {
  for (const path of ['/bad', '/short-timeout', '/invalid-timeout', '/cleanup-fail']) {
    const response = await inspect(mock, path); assert.equal(response.status, 502); assert.equal(await response.text(), 'Container inspection failed');
  }
  const response = await inspect(mock, '/success'); assert.equal(response.status, 200); assert.equal(await response.text(), success);
});

test('ordinary native DO has no Container; reserved slot cannot be supplied by environment', async () => {
  const absent = await inspect(missing, '/success'); assert.equal(absent.status, 502); assert.equal(await absent.text(), 'Container inspection failed');
  const conflict = await inspect(reserved, '/success'); assert.equal(conflict.status, 502); assert.equal(await conflict.text(), 'Container request failed');
  await assert.rejects((await reserved.durableStub('OBJECTS', 'reserved-direct')).fetch('https://example.test/success'), /reserved libcf Durable Object bindings conflict/);
  // A real empty capability is not forged into the valid null inspection result.
  const healthy = await inspect(missing, '/'); assert.equal(healthy.status, 200); await healthy.arrayBuffer();
});

test('production Container config remains refused by the default local harness', async () => {
  await assert.rejects(startLocalWorker('examples/container/wrangler.jsonc'), /explicit local engine\/image/);
});
