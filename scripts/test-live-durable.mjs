import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'durable');
await awaitCertificate(request);
const first = `/objects/${randomUUID()}`;
const second = `/objects/${randomUUID()}`;
const values = await Promise.all(Array.from({ length: 8 }, async () => {
  const response = await request(`${first}/increment`, { method: 'POST' });
  assert.equal(response.status, 200);
  return (await response.json()).value;
}));
assert.deepEqual(values.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.deepEqual(await (await request(`${first}/value`)).json(), { value: 8 });
assert.deepEqual(await (await request(`${second}/value`)).json(), { value: 0 });
assert.equal(await (await request(`${first}/initializations`)).text(), '1');
assert.equal(await (await request(`${second}/initializations`)).text(), '1');
assert.equal((await request(`${first}/rollback`, { method: 'POST' })).status, 409);
assert.deepEqual(await (await request(`${first}/value`)).json(), { value: 8 });
const bytes = Uint8Array.of(0, 255, 128, 65);
const echo = await request(`${first}/echo`, { method: 'POST', body: bytes, headers: { 'x-original': 'cpp-live' } });
assert.equal(echo.status, 201);
assert.equal(echo.headers.get('x-object-header'), 'cpp-live');
assert.deepEqual(new Uint8Array(await echo.arrayBuffer()), bytes);
const sqlEcho = await request(`${first}/sql-echo`, { method: 'POST', body: bytes });
assert.equal(sqlEcho.status, 200);
assert.deepEqual(new Uint8Array(await sqlEcho.arrayBuffer()), bytes);
assert.equal((await request('/missing-binding')).status, 502);
assert.equal((await request('/objects//value')).status, 502);
assert.equal((await request(`${first}/schedule`, { method: 'POST' })).status, 202);
let count = 0;
for (let attempt = 0; attempt < 21; attempt++) {
  const response = await request(`${first}/alarm-count`);
  assert.equal(response.status, 200);
  count = (await response.json()).value;
  if (count === 1) break;
  if (attempt < 20) await new Promise(resolve => setTimeout(resolve, 4000));
}
assert.equal(count, 1);
console.log(JSON.stringify({ host, passed: ['C++ per-object initialization', 'atomic concurrent increments', 'object isolation', 'transaction rollback', 'binary HTTP and SQL', 'binding/name errors', 'C++ alarm effect'], caveat: 'no forced live eviction or retry; delete the isolated Worker and verify namespace cleanup' }));
