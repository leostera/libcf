import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';

let worker;
let base;
before(async () => {
  worker = await startLocalWorker('examples/d1/wrangler.jsonc');
  base = worker.base;
  assert.equal((await fetch(`${base}/setup`, { method: 'POST' })).status, 200);
});
after(async () => { await worker?.dispose(); });

test('parameterized D1 queries store, update, read and delete binary data', async () => {
  const url = `${base}/records/${randomUUID()}`;
  assert.equal((await fetch(url)).status, 404);
  const bytes = Uint8Array.of(0, 255, 128, 65);
  assert.equal((await fetch(url, { method: 'PUT', body: bytes })).status, 201);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(url, { method: 'PUT', body: '' })).status, 201);
  assert.equal(await (await fetch(url)).text(), '');
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(url)).status, 404);
});

test('SQL-looking input is bound as data rather than executed', async () => {
  const url = `${base}/records/${randomUUID()}`;
  const payload = "'); DROP TABLE records; --";
  assert.equal((await fetch(url, { method: 'PUT', body: payload })).status, 201);
  assert.equal(await (await fetch(url)).text(), payload);
  assert.equal((await fetch(`${base}/setup`, { method: 'POST' })).status, 200);
});

test('parallel statements keep request parameters isolated', async () => {
  const prefix = randomUUID();
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const url = `${base}/records/${prefix}-${i}`;
    assert.equal((await fetch(url, { method: 'PUT', body: `row-${i}` })).status, 201);
    assert.equal(await (await fetch(url)).text(), `row-${i}`);
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
  }));
});

test('SQL constraints reject through the C++ Result boundary', async () => {
  const response = await fetch(`${base}/constraint-probe`, { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal(await response.text(), 'constraint rejected');
  assert.equal((await fetch(`${base}/records/constraint-probe`)).status, 404);
});

test('unsupported methods and routes do not mutate the database', async () => {
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/records/${randomUUID()}`, { method: 'POST' })).status, 405);
});
