import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { awaitCertificate, liveHttp } from '../scripts/live-http.mjs';

test('readiness retries transport failures and consumes the successful response', async () => {
  let calls = 0;
  let response;
  await awaitCertificate(async (path, options) => {
    assert.equal(path, '/libcf-readiness-missing-route');
    assert(options.signal instanceof AbortSignal);
    if (++calls < 3) throw new Error('DNS not ready');
    response = new Response('ready', { status: 404 });
    return response;
  }, 404, { timeoutMs: 1000, retryMs: 1 });
  assert.equal(calls, 3);
  assert.equal(response.bodyUsed, true);
});

test('readiness drains unexpected status bodies and caps their size', async () => {
  const wrong = new Response('not ready', { status: 503 });
  let calls = 0;
  await awaitCertificate(async () => ++calls === 1 ? wrong : new Response(null, { status: 404 }),
    404, { timeoutMs: 1000, retryMs: 1 });
  assert.equal(wrong.bodyUsed, true);
  assert.equal(wrong.body.locked, false);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  await assert.rejects(awaitCertificate(async () => new Response(body, { status: 404 }),
    404, { timeoutMs: 30, retryMs: 10000 }), RangeError);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('readiness deadline interrupts a stalled body even when cancellation never settles', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await assert.rejects(awaitCertificate(async () => new Response(body, { status: 404 }),
      404, { timeoutMs: 30, retryMs: 1 }), { name: 'TimeoutError' });
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  } finally { clearTimeout(keepAlive); }
});

test('readiness deadline bounds retry sleeps and retains the last failure', { timeout: 2000 }, async () => {
  let calls = 0;
  await assert.rejects(awaitCertificate(async () => { calls++; throw new Error('ENOTFOUND fixture'); }, 404,
    { timeoutMs: 30, retryMs: 10000 }), /ENOTFOUND fixture/);
  assert.equal(calls, 1);
});

test('readiness deadline reaches an in-flight request', { timeout: 2000 }, async () => {
  let signal;
  await assert.rejects(awaitCertificate(async (_, options) => {
    signal = options.signal;
    await delay(10000, undefined, { signal });
    return new Response(null, { status: 404 });
  }, 404, { timeoutMs: 30, retryMs: 1 }), { name: 'AbortError' });
  assert.equal(signal.aborted, true);
});

test('invalid budgets reject without invoking the request', async () => {
  for (const timeoutMs of [0, -1, 2700001, NaN, Infinity, 1.5, '30000'])
    await assert.rejects(awaitCertificate(() => assert.fail('must not request'), 404, { timeoutMs }), RangeError);
  for (const retryMs of [0, -1, 10001, NaN, 1.5])
    await assert.rejects(awaitCertificate(() => assert.fail('must not request'), 404, { retryMs }), RangeError);
});

test('live URL policy rejects trailing newlines and path-based authority escapes', () => {
  const host = 'libcf-crypto-0123456789.libcf.leostera.dev';
  assert.throws(() => liveHttp(undefined, 'crypto'), /isolated test hostname/);
  assert.throws(() => liveHttp(`${host}\n`, 'crypto'), /isolated test hostname/);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('unexpected dispatch'); };
  try {
    const request = liveHttp(host, 'crypto');
    for (const path of ['@evil.test/', '//evil.test/', '/\\\\evil.test/', `//user@${host}/`, 'https://evil.test/', undefined])
      assert.throws(() => request(path), /origin-relative|isolated origin/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('manual redirect inspection is explicit and cannot follow an off-origin Location', async () => {
  const original = globalThis.fetch;
  const modes = [];
  globalThis.fetch = async (_url, options) => {
    modes.push(options.redirect);
    return new Response(null, { status: 302, headers: { location: 'https://foreign.invalid/' } });
  };
  try {
    const request = liveHttp('libcf-http-client-0123456789.libcf.leostera.dev', 'http-client');
    assert.equal((await request('/manual', { redirect: 'manual' })).status, 302);
    await request('/default');
    await request('/override', { redirect: 'follow' });
    assert.deepEqual(modes, ['manual', 'error', 'error']);
  } finally { globalThis.fetch = original; }
});

test('HTTPS probe preserves caller cancellation while enforcing redirect policy', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/libcf-crypto-[a-f0-9]{10}\.libcf\.leostera\.dev\//);
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, true);
    return new Response();
  };
  try { await liveHttp('libcf-crypto-0123456789.libcf.leostera.dev', 'crypto')('/', { signal: controller.signal, redirect: 'follow' }); }
  finally { globalThis.fetch = original; }
});
