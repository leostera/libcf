import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/service-tcp/wrangler.jsonc', {
  additionalConfigs: ['examples/service-tcp/reference/wrangler.jsonc'],
}); });
after(async () => { await worker?.dispose(); });
const send = (path, body) => fetch(`${worker.base}${path}`, { method: 'POST', body, signal: AbortSignal.timeout(10000) });

test('C++ service TCP exchanges empty, binary and 1-MiB buffers through a native connect handler', async () => {
  for (const body of [new Uint8Array(), Uint8Array.of(0, 1, 127, 128, 255), new Uint8Array(1048576).fill(197)]) {
    const response = await send('/echo', body);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  }
});

test('concurrent invocations retain independent request bytes', async () => {
  await Promise.all(Array.from({ length: 8 }, async (_, id) => {
    const body = new Uint8Array(1024).fill(id);
    const response = await send('/echo', body);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  }));
});

test('invalid address, reply overflow and deadline fail, then the next exchange recovers', async () => {
  for (const path of ['/bad-address', '/overflow', '/timeout']) {
    const response = await send(path, 'payload');
    assert.equal(response.status, 502, path);
    await response.text();
  }
  const response = await send('/echo', 'recovered');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'recovered');
});
