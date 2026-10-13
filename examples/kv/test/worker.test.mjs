import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';

let worker;
let base;
const suffix = randomUUID();
before(async () => {
  worker = await startLocalWorker('examples/kv/wrangler.jsonc');
  base = worker.base;
});
after(async () => { await worker?.dispose(); });

test('text CRUD distinguishes missing and empty values', async () => {
  const url = `${base}/items/empty-${suffix}`;
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { method: 'PUT', body: '' })).status, 201);
  const empty = await fetch(url);
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), '');
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(url)).status, 404);
});

test('binary values cross the C++ ABI without text decoding', async () => {
  const url = `${base}/bytes/binary-${suffix}`;
  const bytes = Uint8Array.of(0, 255, 128, 65, 0);
  assert.equal((await fetch(url, { method: 'PUT', body: bytes })).status, 201);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('metadata and TTL options reach KV', async () => {
  const key = `metadata-${suffix}`;
  const response = await fetch(`${base}/items/${key}`, {
    method: 'PUT', body: 'value', headers: { 'x-ttl': '60', 'x-metadata': '{"source":"cpp"}' },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await (await fetch(`${base}/metadata/${key}`)).json(), {
    value: 'value', metadata: { source: 'cpp' },
  });
});

test('list follows cursors while retaining the prefix', async () => {
  const keys = [`item:${suffix}:a`, `item:${suffix}:b`];
  for (const key of keys) {
    assert.equal((await fetch(`${base}/items/${key}`, { method: 'PUT', body: key })).status, 201);
  }
  const response = await fetch(`${base}/list`);
  assert.equal(response.status, 200);
  const page = await response.json();
  for (const key of keys) assert.ok(page.keys.includes(key));
  assert.ok(page.keys.every(key => key.startsWith('item:')));
  for (const key of keys) await fetch(`${base}/items/${key}`, { method: 'DELETE' });
});

test('invalid metadata and TTL fail without writing the value', async () => {
  for (const headers of [
    { 'x-metadata': '{broken' },
    { 'x-metadata': 'null,"expirationTtl":60' },
    { 'x-ttl': '1' },
  ]) {
    const key = `invalid-${randomUUID()}`;
    const response = await fetch(`${base}/items/${key}`, { method: 'PUT', body: 'must-not-write', headers });
    assert.equal(response.status, 502);
    assert.equal((await fetch(`${base}/items/${key}`)).status, 404);
  }
  assert.equal((await fetch(`${base}/items/invalid-ttl`, {
    method: 'PUT', body: 'no', headers: { 'x-ttl': 'not-a-number' },
  })).status, 400);
});
