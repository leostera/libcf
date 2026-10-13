import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';

let worker;
let base;
before(async () => {
  worker = await startLocalWorker('examples/core/wrangler.jsonc', '/hello/ready');
  base = worker.base;
});
after(async () => { await worker?.dispose(); });

test('C++ router selects named parameters and returns HTTP status', async () => {
  const response = await fetch(`${base}/hello/Ada`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Hello, Ada!');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/hello/Ada`, { method: 'POST' })).status, 405);
});

test('environment values and header names cross the ABI safely', async () => {
  assert.equal(await (await fetch(`${base}/env/GREETING`)).text(), 'hello-from-env');
  assert.equal((await fetch(`${base}/env/MISSING`)).status, 404);
  const response = await fetch(`${base}/header`, { headers: { 'X-Greeting': 'sent by client' } });
  assert.equal(await response.text(), 'sent by client');
  assert.equal(await (await fetch(`${base}/header`)).text(), 'absent');
});

test('C++ coroutine awaits the async Assets.fetch binding', async () => {
  const response = await fetch(`${base}/asset`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'C++[fetched-from-assets\n]');
});

test('bounded binary request bytes and response headers survive round trip', async () => {
  const bytes = Uint8Array.of(0, 1, 2, 127, 128, 254, 255);
  const response = await fetch(`${base}/echo`, { method: 'POST', body: bytes });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-libcf'), 'cpp');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('rejects oversized request body at JS boundary before C++ is called', async () => {
  const response = await fetch(`${base}/echo`, { method: 'POST', body: new Uint8Array(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.equal((await fetch(`${base}/hello/after-error`)).status, 200);
});

test('C++ UUID uses host cryptographic randomness', async () => {
  const one = await (await fetch(`${base}/uuid`)).text();
  const two = await (await fetch(`${base}/uuid`)).text();
  assert.match(one, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(one, two);
});

test('parallel requests do not share environment or response state', async () => {
  const names = Array.from({ length: 16 }, (_, index) => `user-${index}`);
  const result = await Promise.all(names.map(async name => (await fetch(`${base}/hello/${name}`)).text()));
  assert.deepEqual(result, names.map(name => `Hello, ${name}!`));
});
