import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let base;
before(async () => { worker = await startLocalWorker('examples/events/wrangler.jsonc'); base = worker.base; });
after(async () => { await worker?.dispose(); });
async function delivered(body) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/lookup`, { method: 'POST', body });
    if (response.status === 200) return response;
    assert.equal(response.status, 404);
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Queue delivery timed out');
}

test('C++ producer and consumer preserve text and bytes', async () => {
  const text = randomUUID();
  assert.equal((await fetch(`${base}/send/text`, { method: 'POST', body: text })).status, 202);
  const textResult = await delivered(text);
  assert.equal(textResult.headers.get('x-body-format'), 'text');
  assert.equal(await textResult.text(), text);
  const bytes = Uint8Array.of(0, 255, 128, 65);
  assert.equal((await fetch(`${base}/send/bytes`, { method: 'POST', body: bytes })).status, 202);
  const bytesResult = await delivered(bytes);
  assert.equal(bytesResult.headers.get('x-body-format'), 'bytes');
  assert.deepEqual(new Uint8Array(await bytesResult.arrayBuffer()), bytes);
});

test('explicit retry redelivers before acknowledgement', async () => {
  const text = `retry:${randomUUID()}`;
  assert.equal((await fetch(`${base}/send/text`, { method: 'POST', body: text })).status, 202);
  const response = await delivered(text);
  assert.equal(response.headers.get('x-attempts'), '2');
  assert.equal(await response.text(), text);
});

test('scheduled controller metadata reaches C++ and durable storage', async () => {
  const scheduledTime = new Date('2026-10-13T12:00:00.000Z');
  const result = await worker.scheduled({ scheduledTime, cron: '* * * * *' });
  assert.equal(result.outcome, 'ok');
  const response = await fetch(`${base}/scheduled-status`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '* * * * *');
  assert.equal(response.headers.get('x-scheduled-time'), String(scheduledTime.getTime()));
});

test('scheduled handler failure is not reported as successful delivery', async () => {
  const result = await worker.scheduled({ cron: 'fail-for-test' });
  assert.notEqual(result.outcome, 'ok');
});

test('oversized Queue message rejects before sending', async () => {
  const response = await fetch(`${base}/send/bytes`, { method: 'POST', body: new Uint8Array(128 * 1024) });
  assert.equal(response.status, 502);
});
