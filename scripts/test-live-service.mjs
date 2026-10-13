import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'service');
await awaitCertificate(request, 201);
const body = Uint8Array.of(0, 255, 128, 65);
const response = await request('/echo', { method: 'POST', body, headers: { 'x-original': 'preserved' } });
assert.equal(response.status, 201);
assert.equal(response.headers.get('x-caller'), 'cpp');
assert.equal(response.headers.get('x-method'), 'POST');
assert.equal(response.headers.get('x-forwarded'), 'preserved');
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
const failed = await request('/fail');
assert.equal(failed.status, 503);
assert.equal(await failed.text(), 'upstream unavailable');
const empty = await request('/empty');
assert.equal(empty.status, 204);
assert.equal(await empty.text(), '');
for (const path of ['/oversized', '/missing-binding']) {
  const rejected = await request(path);
  assert.equal(rejected.status, 502);
  assert.equal(await rejected.text(), 'service call failed');
}
assert.equal((await request('/empty')).status, 204);
console.log(JSON.stringify({ host, passed: ['POST/binary/headers', 'HTTP 503', 'bodyless 204', 'oversized response', 'missing binding', 'recovery'], scope: 'buffered HTTP service binding; no RPC or end-to-end streaming claim' }));
