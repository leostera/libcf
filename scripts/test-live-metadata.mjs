import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const [host, expectedVersion] = process.argv.slice(2);
const request = liveHttp(host, 'metadata');
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedVersion ?? ''))
  throw new Error('Expected the uploaded version UUID');
await awaitCertificate(request);
let timestamp;
for (let attempt = 0; attempt < 3; attempt++) {
  const response = await request('/version');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expectedVersion);
  assert.equal(response.headers.get('x-version-tag'), '');
  const observed = response.headers.get('x-version-timestamp');
  assert(Number.isFinite(Date.parse(observed)));
  if (timestamp !== undefined) assert.equal(observed, timestamp);
  timestamp = observed;
}
const missing = await request('/missing-version');
assert.equal(missing.status, 502);
assert.equal(await missing.text(), 'metadata unavailable');
console.log(JSON.stringify({ host, version: expectedVersion, timestamp,
  passed: ['deployed version identity', 'untagged version', 'stable timestamp', 'missing binding error'],
  secretsStore: 'not bound or tested live' }, null, 2));
