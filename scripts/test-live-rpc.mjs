import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'rpc');
await awaitCertificate(request);
for (const value of [null, true, 1.25, '☁', { nested: [null, 'owned', 42] }]) {
  const response = await request('/echo', { method: 'POST', body: JSON.stringify([value]) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), value);
}
const exact = 'x'.repeat(1048572);
const large = await request('/echo', { method: 'POST', body: JSON.stringify([exact]) });
assert.equal(large.status, 200);
assert.equal(await large.json(), exact);
const responses = await Promise.all(Array.from({ length: 8 }, () => request('/sum')));
for (const response of responses) { assert.equal(response.status, 200); assert.equal(await response.text(), '42'); }
for (const path of ['/failure', '/capability', '/large', '/reserved', '/missing']) {
  const response = await request(path);
  assert.equal(response.status, 502, path);
  assert.equal(await response.text(), 'RPC failed');
}
for (const body of ['{}', 'invalid', JSON.stringify(Array(33).fill(null))]) {
  const response = await request('/echo', { method: 'POST', body });
  assert.equal(response.status, 502); await response.arrayBuffer();
}
const recovery = await request('/sum');
assert.equal(recovery.status, 200); assert.equal(await recovery.text(), '42');
console.log(JSON.stringify({ host, passed: ['scalar/nested JSON', 'exact 1-MiB argument body',
  '8 concurrent calls', 'provider/unsupported/capability/size/reserved/missing failures',
  'invalid arguments', 'recovery'], cppRpcExports: false, serverDisposerTimingVerified: false }, null, 2));
