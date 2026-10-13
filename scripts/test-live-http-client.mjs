import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'http-client');
const upstreamHost = host.replace('libcf-http-client-', 'libcf-http-upstream-');
const upstream = liveHttp(upstreamHost, 'http-upstream');
// Both budgets run together: retain both names through one readiness window.
await Promise.all([awaitCertificate(request), awaitCertificate(upstream)]);
const body = new Uint8Array([0, 255, 1, 128]);
const echoed = await request('/echo', { method: 'POST', body, headers: {
  'x-client': 'fixture', authorization: 'synthetic-not-a-credential', cookie: 'synthetic=fixture',
} });
assert.equal(echoed.status, 201);
assert.deepEqual(new Uint8Array(await echoed.arrayBuffer()), body);
assert.equal(echoed.headers.get('x-upstream-method'), 'POST');
assert.equal(echoed.headers.get('x-upstream-host'), upstreamHost);
assert.equal(echoed.headers.get('x-client'), 'fixture');
assert.equal(echoed.headers.get('x-has-authorization'), 'false');
assert.equal(echoed.headers.get('x-has-cookie'), 'false');
const manual = await request('/manual', { redirect: 'manual' });
assert.equal(manual.status, 302);
assert.equal(manual.headers.get('location'), '/echo');
await manual.arrayBuffer();
for (const [path, status] of [['/follow', 201], ['/error', 502], ['/large', 502], ['/empty', 204], ['/failure', 503], ['/echo', 201]]) {
  const response = await request(path);
  assert.equal(response.status, status, path);
  const text = await response.text();
  if (status === 502) assert.equal(text, 'upstream failed');
  if (status === 204) assert.equal(text, '');
  if (status === 503) assert.equal(text, 'fixture upstream unavailable');
}
console.log(JSON.stringify({ host, upstreamHost, passed: ['binary/status/headers', 'credential non-forwarding',
  'manual/follow/error redirects', 'body bound/recovery', '204 and 503 responses'], connectionFailure: 'local-only' }, null, 2));
