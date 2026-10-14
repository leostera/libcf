import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
import { readBounded } from '../lib/body.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'service-tcp');
await awaitCertificate(request);
for (const body of [new Uint8Array(), Uint8Array.of(0, 1, 127, 128, 255), new Uint8Array(1048576).fill(197)]) {
  const response = await request('/echo', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(await readBounded(response.body, body.byteLength), body);
}
await Promise.all(Array.from({ length: 8 }, async (_, id) => {
  const body = new Uint8Array(1024).fill(id);
  const response = await request('/echo', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(await readBounded(response.body, body.byteLength), body);
}));
for (const path of ['/bad-address', '/overflow', '/timeout']) {
  const response = await request(path, { method: 'POST', body: 'payload' });
  assert.equal(response.status, 502, path);
  assert.equal(new TextDecoder().decode(await readBounded(response.body, 64)), 'service TCP exchange failed');
}
const recovery = await request('/echo', { method: 'POST', body: 'recovered' });
assert.equal(recovery.status, 200);
assert.equal(new TextDecoder().decode(await readBounded(recovery.body, 64)), 'recovered');
console.log(JSON.stringify({ host, passed: ['empty/binary/1-MiB service TCP exchange',
  '8 concurrent owned buffers', 'invalid address', 'reply overflow', 'deadline', 'recovery'],
  publicTcpListener: false, externalTcpDestination: false, socketTlsVerified: false,
  cppInboundHandler: false, remoteRollbackVerified: false }, null, 2));
