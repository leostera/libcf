import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const host = process.argv[2];
if (!/^libcf-cache-[a-f0-9]{10}\.libcf\.leostera\.dev$/.test(host ?? ''))
  throw new Error('Expected an isolated cache hostname under libcf.leostera.dev');
const base = `https://${host}`;
async function request(path, init = {}) {
  return fetch(`${base}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
}
// Custom-domain certificate activation may lag deployment. Never disable TLS
// verification or fall back to workers.dev to make a live check pass.
let ready = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const response = await request('/entries/readiness');
    assert.equal(response.status, 404);
    await response.arrayBuffer();
    ready = true;
    break;
  } catch (error) {
    if (attempt === 89) throw error;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
assert(ready);
const path = `/entries/${randomUUID()}`;
const body = Uint8Array.of(0, 128, 255, 65);
try {
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, { method: 'PUT', body })).status, 201);
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-origin'), 'cf');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  assert.equal(await (await request(path, { method: 'DELETE' })).text(), 'deleted');
  assert.equal((await request(path)).status, 404);
  console.log(JSON.stringify({ host, passed: ['miss', 'put', 'binary match', 'headers', 'delete'], scope: 'single client/location only' }));
} finally {
  await request(path, { method: 'DELETE' });
}
