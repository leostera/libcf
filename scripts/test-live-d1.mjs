import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'd1');
await awaitCertificate(request);
assert.equal((await request('/setup', { method: 'POST' })).status, 200);
const id = randomUUID();
const committed = randomUUID();
const rolledBack = randomUUID();
try {
  const path = `/records/${id}`;
  assert.equal((await request(path)).status, 404);
  const body = Uint8Array.of(0, 128, 255, 65);
  assert.equal((await request(path, { method: 'PUT', body })).status, 201);
  assert.deepEqual(new Uint8Array(await (await request(path)).arrayBuffer()), body);
  assert.equal((await request(path, { method: 'PUT', body: 'updated' })).status, 201);
  assert.equal(await (await request(path)).text(), 'updated');
  const row = await request('/first-null');
  assert.equal(row.status, 200);
  assert.equal(await row.text(), 'SQL NULL');
  assert.equal((await request('/first-missing')).status, 404);
  assert.equal((await request(`/batch/${committed}`, { method: 'POST', body: 'committed' })).status, 201);
  assert.equal(await (await request(`/records/${committed}`)).text(), 'committed');
  assert.equal((await request(`/batch/${rolledBack}`, {
    method: 'POST', body: 'must roll back', headers: { 'x-fail-batch': 'yes' },
  })).status, 409);
  assert.equal((await request(`/records/${rolledBack}`)).status, 404);
  assert.equal((await request(`/records/${rolledBack}-invalid`)).status, 404);
  assert.equal((await request('/constraint-probe', { method: 'POST' })).status, 409);
  assert.equal((await request(path, { method: 'DELETE' })).status, 200);
  assert.equal((await request(path)).status, 404);
  console.log(JSON.stringify({ host, passed: ['setup/exec', 'binary CRUD', 'first/null/missing', 'batch commit', 'batch rollback', 'constraint error'] }));
} finally {
  for (const key of [id, committed, rolledBack, `${rolledBack}-invalid`])
    await request(`/records/${key}`, { method: 'DELETE' });
}
