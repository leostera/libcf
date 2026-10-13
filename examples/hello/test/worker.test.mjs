import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';

let worker;
let base;

before(async () => {
  worker = await startLocalWorker('examples/hello/wrangler.jsonc');
  base = worker.base;
});
after(async () => { await worker?.dispose(); });

test('C++ ABI and environment variable run inside workerd', async () => {
  const response = await fetch(`${base}/?a=20&b=22`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'C++: 42');
});

test('Promise continuation returns KV data through C++ and preserves concurrent IDs', async () => {
  const pairs = Array.from({ length: 12 }, (_, i) => [`libcf-spike-${i}`, `value-${i}`]);
  await Promise.all(pairs.map(async ([key, value]) => {
    const response = await fetch(`${base}/write?key=${key}&value=${value}`);
    assert.equal(response.status, 202);
  }));
  const results = await Promise.all(pairs.map(async ([key]) => {
    const response = await fetch(`${base}/get?key=${key}`);
    assert.equal(response.status, 200);
    return response.text();
  }));
  assert.deepEqual(results, pairs.map(([, value]) => `C++[${value}]`));
});

test('missing KV item resolves error path rather than leaking a pending promise', async () => {
  const response = await fetch(`${base}/get?key=libcf-spike-missing`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'not found');
  assert.equal((await fetch(`${base}/?a=2&b=3`)).status, 200);
});

test('C++ invokes an async static-assets fetch through the Worker binding', async () => {
  const response = await fetch(`${base}/asset`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'C++[asset-body\n]');
});

test('rejected binding Promise reaches the C++ error branch', async () => {
  const response = await fetch(`${base}/get?key=`);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'binding error');
});

test('ReadableStream asks C++ for each chunk and rejects invalid counts', async () => {
  const response = await fetch(`${base}/stream?count=32`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), Array.from({ length: 32 }, (_, i) => `chunk-${i}\n`).join(''));
  assert.equal((await fetch(`${base}/stream?count=-1`)).status, 400);
  const cancelled = await fetch(`${base}/stream?count=128`);
  const reader = cancelled.body.getReader();
  // HTTP can coalesce stream chunks; a read is not a chunk boundary.
  assert.ok(new TextDecoder().decode((await reader.read()).value).startsWith('chunk-0\n'));
  await reader.cancel();
  assert.equal((await fetch(`${base}/?a=1&b=1`)).status, 200);
});
