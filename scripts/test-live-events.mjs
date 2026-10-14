import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';
import { awaitScheduled } from './live-scheduled.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'events');
await awaitCertificate(request);
async function delivered(body) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await request('/lookup', { method: 'POST', body });
    if (response.status === 200) return response;
    assert.equal(response.status, 404);
    await response.arrayBuffer();
    if (attempt < 89) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.fail('live Queue delivery timed out');
}
const text = randomUUID();
assert.equal((await request('/send/text', { method: 'POST', body: text })).status, 202);
const textResult = await delivered(text);
assert.equal(textResult.headers.get('x-body-format'), 'text');
assert.equal(await textResult.text(), text);
const bytes = Uint8Array.of(0, 255, 128, 65);
assert.equal((await request('/send/bytes', { method: 'POST', body: bytes })).status, 202);
const bytesResult = await delivered(bytes);
assert.equal(bytesResult.headers.get('x-body-format'), 'bytes');
assert.deepEqual(new Uint8Array(await bytesResult.arrayBuffer()), bytes);
const retry = `retry:${randomUUID()}`;
assert.equal((await request('/send/text', { method: 'POST', body: retry })).status, 202);
const retryResult = await delivered(retry);
assert(Number(retryResult.headers.get('x-attempts')) >= 2);
assert.equal(await retryResult.text(), retry);
assert.equal((await request('/send/bytes', { method: 'POST', body: new Uint8Array(128 * 1024) })).status, 502);
console.log(JSON.stringify({ host, queuePassed: ['text', 'bytes', 'explicit retry/redelivery', 'oversized rejection'] }));

// Observe a real Cron event. There is deliberately no HTTP route that can
// manufacture scheduled invocations; propagation may take several minutes.
const observed = await awaitScheduled(request);
console.log(JSON.stringify({ host, scheduledPassed: observed, cleanup: 'delete consumer, Worker/triggers, queue and isolated D1 database' }));
