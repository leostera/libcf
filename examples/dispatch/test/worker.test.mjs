import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/dispatch/test/local.wrangler.jsonc', {
  additionalConfigs: ['examples/dispatch/reference/wrangler.jsonc'],
}); });
after(async () => { await worker?.dispose(); });
const send = (body, path = '/echo') => fetch(`${worker.base}${path}`, {
  method: 'POST', body, headers: { 'x-input': 'owned' }, redirect: 'manual',
});

test('C++ dispatch through mock namespace and native local Fetcher preserves binary/status/headers', async () => {
  for (const body of [new Uint8Array(), new Uint8Array([0, 1, 127, 128, 255]), new Uint8Array(1048576 - 65536 - 44).fill(197)]) {
    const response = await send(body);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-input'), 'owned');
    assert.equal(response.headers.get('x-method'), 'POST');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  }
  await Promise.all(Array.from({ length: 8 }, async (_, id) => {
    const body = new Uint8Array(1024).fill(id);
    const response = await send(body);
    assert.equal(response.status, 201);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  }));
});

test('missing/invalid targets and overflow fail; redirects stay manual; next request recovers', async () => {
  for (const path of ['/missing', '/invalid', '/overflow']) {
    const response = await send('fixture', path);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), 'dispatch failed');
  }
  const redirect = await send('fixture', '/redirect');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://not-contacted.invalid/');
  await redirect.text();
  const oversizedRequest = await send(new Uint8Array(1048576));
  assert.equal(oversizedRequest.status, 502);
  await oversizedRequest.text();
  const maximumReply = await send('', '/max-reply');
  assert.equal(maximumReply.status, 200);
  assert.equal((await maximumReply.arrayBuffer()).byteLength, 1048576);
  const response = await send('recovered');
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'recovered');
});

test('production dispatch config is rejected instead of creating remote local traffic', async () => {
  await assert.rejects(startLocalWorker('examples/dispatch/wrangler.jsonc'), /explicit local mock/);
});
