import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/email/wrangler.jsonc', { triggerHandlers: true }); });
after(async () => { await worker?.dispose(); });
async function deliver({ to = 'inbox@example.test', subject = 'hello', extra = '', body = 'hello from SMTP', expectedStatus = 200 } = {}) {
  const id = `<${randomUUID()}@example.test>`;
  const raw = `From: forged-header@example.test\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\n${extra}\r\n${body}`;
  const response = await fetch(`${worker.base}/cdn-cgi/local/email?from=envelope@example.test&to=${encodeURIComponent(to)}&format=json`, {
    method: 'POST', body: raw,
  });
  assert.equal(response.status, expectedStatus);
  return { id, result: await response.json() };
}

test('C++ consumes raw email only after storing envelope metadata and bytes', async () => {
  const { id, result } = await deliver({ extra: 'Content-Length: 999999999\r\n' });
  assert.equal(result.outcome, 'ok');
  const stored = await fetch(`${worker.base}/lookup`, { method: 'POST', body: id });
  assert.equal(stored.status, 200);
  assert.equal(stored.headers.get('x-envelope-from'), 'envelope@example.test');
  assert.equal(stored.headers.get('x-envelope-to'), 'inbox@example.test');
  const raw = await stored.text();
  assert(raw.includes('hello from SMTP'));
  assert(raw.includes('Content-Length: 999999999'));
});

test('C++ rejection is explicit and never forwards', async () => {
  const { result } = await deliver({ to: 'reject@example.test' });
  assert.equal(result.outcome, 'ok');
  assert.equal(result.rejectReason, 'blocked by C++ example');
  assert.deepEqual(result.forwards, []);
});

test('C++ forwarding is captured by the local simulator without sending real mail', async () => {
  const { result } = await deliver({ to: 'forward@example.test' });
  assert.equal(result.outcome, 'ok');
  assert.equal(result.forwards.length, 1);
  assert.equal(result.forwards[0].recipient, 'archive@example.test');
});

test('handler failure and missing disposition do not silently consume mail', async () => {
  for (const subject of ['fail', 'no-disposition']) {
    const { result } = await deliver({ subject, expectedStatus: 500 });
    assert.equal(result.outcome, 'exception');
    assert.deepEqual(result.forwards, []);
  }
});

test('oversized raw email fails before the C++ storage side effect', async () => {
  const { id, result } = await deliver({ body: 'x'.repeat(1024 * 1024), expectedStatus: 500 });
  assert.equal(result.outcome, 'exception');
  assert.equal((await fetch(`${worker.base}/lookup`, { method: 'POST', body: id })).status, 404);
});
