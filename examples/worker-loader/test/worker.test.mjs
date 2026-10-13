import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/worker-loader/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });

test('C++ loads isolated code and forwards HTTP without inheriting bindings', async () => {
  const result = await fetch(`${worker.base}/echo`, { method: 'POST', body: 'fixture' });
  assert.equal(result.status, 201);
  assert.equal(await result.text(), 'child:fixture');
  assert.equal(result.headers.get('x-child-env-count'), '0');
  assert.equal(result.headers.get('x-child-method'), 'POST');
  assert.equal(await (await fetch(`${worker.base}/other`)).text(), 'different-code');
  assert.equal(await (await fetch(`${worker.base}/echo`)).text(), 'child:');
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const route = index % 2 ? '/other' : '/echo';
    const response = await fetch(`${worker.base}${route}`, { method: 'POST', body: `call-${index}` });
    assert.equal(await response.text(), index % 2 ? 'different-code' : `child:call-${index}`);
  }));
});

test('dynamic Worker cannot use fetch or TCP egress', async () => {
  assert.equal(await (await fetch(`${worker.base}/network-sentinel`)).text(), 'reachable');
  for (const path of ['/blocked-fetch', '/blocked-connect']) {
    const response = await fetch(`${worker.base}${path}`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /^blocked:This worker is not permitted to access the internet/);
  }
});

test('missing bindings, invalid/oversized code and response bounds fail without poisoning later calls', async () => {
  for (const path of ['/missing', '/invalid-source', '/oversized-source', '/oversized-response']) {
    const response = await fetch(`${worker.base}${path}`);
    assert.equal(response.status, 502, path);
    assert.equal(await response.text(), 'child execution failed');
  }
  assert.equal(await (await fetch(`${worker.base}/other`)).text(), 'different-code');
});
