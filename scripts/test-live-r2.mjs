import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'r2');
await awaitCertificate(request);
const key = randomUUID();
const empty = randomUUID();
const listed = [0, 1, 2].map(i => `listed-${randomUUID()}-${i}`);
try {
  const path = `/objects/${key}`;
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, { method: 'HEAD' })).status, 404);
  const body = Uint8Array.of(0, 128, 255, 65, 66);
  const put = await request(path, { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(put.status, 201);
  const etag = put.headers.get('etag');
  assert(etag);
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), etag);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  const head = await request(path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-object-size'), '5');
  const range = await request(path, { headers: { 'x-offset': '2' } });
  assert.equal(range.status, 200);
  assert.deepEqual(new Uint8Array(await range.arrayBuffer()), body.slice(2, 4));
  assert.equal((await request(path, { headers: { 'x-offset': '9007199254740992' } })).status, 502);
  assert.equal((await request(`/objects/${empty}`, { method: 'PUT', body: '' })).status, 201);
  const emptyResponse = await request(`/objects/${empty}`);
  assert.equal(emptyResponse.status, 200);
  assert.equal(await emptyResponse.text(), '');
  for (const name of listed)
    assert.equal((await request(`/objects/${name}`, { method: 'PUT', body: name })).status, 201);
  const page = await request('/list');
  assert.equal(page.status, 200);
  const names = (await page.text()).trim().split('\n');
  for (const name of listed) assert(names.includes(name));
  assert(names.every(name => name.startsWith('listed-')));
} finally {
  for (const name of [key, empty, ...listed])
    assert.equal((await request(`/objects/${name}`, { method: 'DELETE' })).status, 200);
}
assert.equal((await request(`/objects/${key}`)).status, 404);
console.log(JSON.stringify({ host, passed: ['binary CRUD', 'metadata/etag', 'HEAD', 'range', 'invalid offset', 'empty/missing', 'prefix pagination', 'delete'] }));
