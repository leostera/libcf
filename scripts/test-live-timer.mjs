import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'timer');
await awaitCertificate(request);
await Promise.all(Array.from({ length: 12 }, async (_, id) => {
  const path = `/${id % 2 ? 'zero' : 'sleep'}?id=${id}`;
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), `https://${host}${path}`);
}));
for (const path of ['/negative', '/oversized']) {
  const response = await request(path);
  assert.equal(response.status, 400);
  assert.equal(await response.text(), 'sleep failed');
}
const response = await request('/sleep');
assert.equal(response.status, 200);
await response.arrayBuffer();
console.log(JSON.stringify({ host, passed: ['zero/nonzero sleeps', '12 concurrent owned URLs', 'invalid durations and recovery'], precisionGuarantee: false }, null, 2));
