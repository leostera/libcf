import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'workflow');
await awaitCertificate(request);
const ids = Array.from({ length: 3 }, () => `fixture-${randomUUID()}`);
// Record caller-selected identities before any potentially ambiguous mutation.
console.log(JSON.stringify({ host, phase: 'instance-identities', ids }));
async function call(path, method = 'GET', body, signal) {
  const response = await request(path, { method, body, signal });
  return { status: response.status, text: await response.text() };
}
async function output(id) {
  const response = await call(`/fixture-output?id=${id}`);
  assert.equal(response.status, 200);
  return JSON.parse(response.text);
}
async function state(id, acceptable) {
  const deadline = AbortSignal.timeout(45000);
  while (true) {
    const response = await call(`/state/${id}`, 'GET', undefined, deadline);
    assert.equal(response.status, 200);
    if (acceptable.includes(response.text)) return response.text;
    assert(!['errored', 'terminated', 'unknown'].includes(response.text), response.text);
    await delay(250, undefined, { signal: deadline });
  }
}
const outstanding = new Set();
try {
  const [echo, event, active] = ids;
  const params = { fixture: 'live', nested: [null, true, '☁', 1.25] };
  outstanding.add(echo);
  assert.equal((await call(`/create/${echo}`, 'POST', JSON.stringify(params))).status, 201);
  await state(echo, ['complete']);
  assert.deepEqual(await output(echo), params);
  assert.equal((await call(`/create/${echo}`, 'POST', '{}')).status, 502);
  outstanding.add(event);
  const initial = { wait: true };
  assert.equal((await call(`/create/${event}`, 'POST', JSON.stringify(initial))).status, 201);
  await state(event, ['running', 'waiting']);
  const payload = [null, true, '☁', { result: 42 }];
  assert.equal((await call(`/event/${event}`, 'POST', JSON.stringify(payload))).status, 202);
  await state(event, ['complete']);
  assert.deepEqual(await output(event), { initial, received: payload });
  outstanding.add(active);
  assert.equal((await call(`/create/${active}`, 'POST', '{"wait":true}')).status, 201);
  await state(active, ['running', 'waiting']);
  for (const id of ids) {
    assert.equal((await call(`/delete/${id}`, 'DELETE')).status, 200);
    const afterDelete = await call(`/state/${id}`);
    console.log(JSON.stringify({ phase: 'post-delete-state', id, ...afterDelete }));
    assert.equal(afterDelete.status, 502, JSON.stringify(afterDelete));
    outstanding.delete(id);
  }
  assert.equal((await call('/create/-invalid', 'POST', '{}')).status, 502);
  assert.equal((await call('/create/invalid-params', 'POST', 'null')).status, 502);
  assert.equal((await call('/missing/absent', 'POST', '{}')).status, 502);
  console.log(JSON.stringify({ host, ids, passed: ['params readback', 'duplicate rejection', 'lifecycle state',
    'event payload and completion', 'completed/active deletion', 'invalid/missing failures'], cppReplay: false }, null, 2));
} finally {
  // Best-effort instance cleanup is not final resource cleanup: the deployment
  // owner must remove/verify the isolated Workflow definition and Worker too.
  for (const id of outstanding) {
    try { console.log(JSON.stringify({ cleanupInstance: id, ...await call(`/delete/${id}`, 'DELETE') })); }
    catch (error) { console.error(`instance cleanup unresolved: ${id}: ${error.message}`); }
  }
}
