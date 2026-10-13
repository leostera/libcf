import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';

let worker;
let base;
before(async () => { worker = await startLocalWorker('examples/r2/wrangler.jsonc'); base = worker.base; });
after(async () => { await worker?.dispose(); });

test('binary upload, metadata, head and deletion work through C++', async () => {
  const url = `${base}/objects/${randomUUID()}`;
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 404);
  const data = Uint8Array.of(0, 128, 255, 65);
  const uploaded = await fetch(url, { method: 'PUT', body: data, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(uploaded.status, 201);
  const etag = uploaded.headers.get('etag');
  assert.ok(etag);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), etag);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), data);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-object-size'), '4');
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(url)).status, 404);
});

test('ranged reads preserve bytes and reject invalid offsets', async () => {
  const url = `${base}/objects/${randomUUID()}`;
  assert.equal((await fetch(url, { method: 'PUT', body: 'abcdef' })).status, 201);
  const response = await fetch(url, { headers: { 'x-offset': '2' } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'cd');
  assert.equal((await fetch(url, { headers: { 'x-offset': 'bad' } })).status, 400);
  assert.equal((await fetch(url, { headers: { 'x-offset': '9007199254740992' } })).status, 502);
  await fetch(url, { method: 'DELETE' });
});

test('empty objects remain distinct from missing objects', async () => {
  const url = `${base}/objects/${randomUUID()}`;
  assert.equal((await fetch(url, { method: 'PUT', body: '' })).status, 201);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  await fetch(url, { method: 'DELETE' });
});

test('list iterates prefix pages without losing keys', async () => {
  const keys = [0, 1, 2].map(i => `listed-${randomUUID()}-${i}`);
  for (const key of keys) assert.equal((await fetch(`${base}/objects/${key}`, { method: 'PUT', body: key })).status, 201);
  const response = await fetch(`${base}/list`);
  assert.equal(response.status, 200);
  const listed = (await response.text()).trim().split('\n');
  for (const key of keys) assert.ok(listed.includes(key));
  assert.ok(listed.every(key => key.startsWith('listed-')));
  for (const key of keys) await fetch(`${base}/objects/${key}`, { method: 'DELETE' });
});
