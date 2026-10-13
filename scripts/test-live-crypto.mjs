import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'crypto');
await awaitCertificate(request);
for (const algorithm of ['sha256', 'sha384', 'sha512']) {
  for (const body of [new Uint8Array(), new Uint8Array([0, 255, 1, 128]), new Uint8Array(1048576)]) {
    const response = await request(`/${algorithm}`, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), createHash(algorithm).update(body).digest('hex'));
  }
}
await Promise.all(Array.from({ length: 6 }, async (_, index) => {
  const body = `live-fixture-${index}`;
  const response = await request('/sha256', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), createHash('sha256').update(body).digest('hex'));
}));
const rejected = await request('/oversized', { method: 'POST' });
assert.equal(rejected.status, 502);
assert.equal(await rejected.text(), 'digest failed');
assert.equal((await request('/sha256', { method: 'POST' })).status, 200);
const random = await (await request('/random')).text();
assert.match(random, /^[a-f0-9]{64}$/);
assert.notEqual(await (await request('/random')).text(), random);
assert.match(await (await request('/uuid')).text(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
console.log(JSON.stringify({ host, passed: ['SHA-256/384/512', 'empty/binary/1-MiB input', 'concurrent isolation',
  'oversized input rejection/recovery', 'RNG/UUID smoke'], entropyAudit: false }, null, 2));
