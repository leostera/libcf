import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let admin;
before(async () => {
  worker = await startLocalWorker('examples/metadata/wrangler.jsonc');
  admin = await worker.secretAdmin('SECRET');
});
after(async () => { await worker?.dispose(); });
const check = (body, path = '/secret-check') => fetch(`${worker.base}${path}`, { method: 'POST', body });

test('C++ receives stable local version ID, empty tag and timestamp', async () => {
  const first = await fetch(`${worker.base}/version`);
  assert.equal(first.status, 200);
  const id = await first.text();
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(first.headers.get('x-version-tag'), '');
  assert(Number.isFinite(Date.parse(first.headers.get('x-version-timestamp'))));
  assert.equal(await (await fetch(`${worker.base}/version`)).text(), id);
  assert.equal((await fetch(`${worker.base}/missing-version`)).status, 502);
});

test('secret absence, empty values, rotation and deletion remain distinct', async () => {
  assert.equal((await check('')).status, 502);
  const id = await admin.create('');
  assert.equal((await check('')).status, 200);
  const value = `synthetic-fixture:${randomUUID()}`;
  await admin.update(value, id);
  assert.equal((await check('')).status, 409);
  const response = await check(value);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'match');
  assert.equal((await check(value, '/missing-secret')).status, 502);
  await admin.delete(id);
  const removed = await check(value);
  assert.equal(removed.status, 502);
  assert.equal(await removed.text(), 'secret unavailable');
});
