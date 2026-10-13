import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let base;
before(async () => { worker = await startLocalWorker('examples/durable/wrangler.jsonc'); base = worker.base; });
after(async () => { await worker?.dispose(); });

test('named C++ stubs isolate objects and concurrent increments are atomic', async () => {
  const first = `${base}/objects/${randomUUID()}`;
  const second = `${base}/objects/${randomUUID()}`;
  const values = await Promise.all(Array.from({ length: 16 }, async () => {
    const response = await fetch(`${first}/increment`, { method: 'POST' });
    assert.equal(response.status, 200);
    return (await response.json()).value;
  }));
  assert.deepEqual(values.sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(await (await fetch(`${first}/value`)).json(), { value: 16 });
  assert.deepEqual(await (await fetch(`${second}/value`)).json(), { value: 0 });
  assert.equal(await (await fetch(`${first}/initializations`)).text(), '1');
  assert.equal(await (await fetch(`${second}/initializations`)).text(), '1');
});

test('stub forwards binary request body, headers and upstream status', async () => {
  const bytes = Uint8Array.of(0, 128, 255);
  const response = await fetch(`${base}/objects/${randomUUID()}/echo`, {
    method: 'POST', body: bytes, headers: { 'x-original': 'cpp' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-object-header'), 'cpp');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}/missing-binding`)).status, 502);
  assert.equal((await fetch(`${base}/objects//value`)).status, 502);
});

test('SQLite transaction rollback is visible through the stub', async () => {
  const url = `${base}/objects/${randomUUID()}`;
  assert.equal((await fetch(`${url}/rollback`, { method: 'POST' })).status, 409);
  assert.deepEqual(await (await fetch(`${url}/value`)).json(), { value: 0 });
});

test('internal object dispatch is not exposed as a public RPC method', async () => {
  const stub = await worker.durableStub('COUNTERS', randomUUID());
  await assert.rejects(async () => {
    await stub.invoke('alarm', new Request('https://example.test/alarm'));
  }, /does not implement the method "invoke"/);
});

test('typed SQLite parameters preserve binary cells', async () => {
  const bytes = Uint8Array.of(0, 255, 128, 65);
  const response = await fetch(`${base}/objects/${randomUUID()}/sql-echo`, { method: 'POST', body: bytes });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('scheduled alarm invokes the C++ handler and persists its effect', async () => {
  const url = `${base}/objects/${randomUUID()}`;
  assert.equal((await fetch(`${url}/schedule`, { method: 'POST' })).status, 202);
  let count = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await fetch(`${url}/alarm-count`);
    assert.equal(response.status, 200);
    count = (await response.json()).value;
    if (count === 1) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(count, 1);
});

test('SQLite state survives a complete local runtime restart', async () => {
  const persistencePath = await mkdtemp(join(tmpdir(), 'libcf-do-persist-'));
  const name = randomUUID();
  let runtime;
  try {
    runtime = await startLocalWorker('examples/durable/wrangler.jsonc', { persistencePath });
    const response = await fetch(`${runtime.base}/objects/${name}/increment`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: 1 });
    await runtime.dispose();
    runtime = undefined;
    runtime = await startLocalWorker('examples/durable/wrangler.jsonc', { persistencePath });
    assert.deepEqual(await (await fetch(`${runtime.base}/objects/${name}/value`)).json(), { value: 1 });
  } finally {
    await runtime?.dispose();
    await rm(persistencePath, { recursive: true, force: true });
  }
});
