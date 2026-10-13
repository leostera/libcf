import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/crypto/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const digest = (algorithm, body) => fetch(`${worker.base}/${algorithm}`, { method: 'POST', body });

test('C++ SHA-2 matches known, empty, binary and maximal-input digests', async () => {
  assert.equal(await (await digest('sha256', 'abc')).text(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const algorithm of ['sha256', 'sha384', 'sha512']) {
    for (const body of [new Uint8Array(), new Uint8Array([0, 255, 1, 128]), new Uint8Array(1048576)]) {
      const response = await digest(algorithm, body);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), createHash(algorithm).update(body).digest('hex'));
    }
  }
});

test('concurrent digests stay isolated and oversized input does not poison recovery', async () => {
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const algorithm = ['sha256', 'sha384', 'sha512'][index % 3];
    const body = `invocation-${index}`;
    assert.equal(await (await digest(algorithm, body)).text(), createHash(algorithm).update(body).digest('hex'));
  }));
  assert.equal((await digest('oversized', '')).status, 502);
  assert.equal((await digest('sha256', '')).status, 200);
});

test('platform RNG and UUID smoke checks do not claim entropy verification', async () => {
  const first = await (await fetch(`${worker.base}/random`)).text();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(await (await fetch(`${worker.base}/random`)).text(), first);
  assert.match(await (await fetch(`${worker.base}/uuid`)).text(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
