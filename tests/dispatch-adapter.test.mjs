import assert from 'node:assert/strict';
import test from 'node:test';
import { performDispatch } from '../lib/dispatch.mjs';
import { readBounded } from '../lib/body.mjs';
import { encodeHeaders } from '../lib/header-wire.mjs';
const helpers = { readBounded, encodeHeaders, encodeFields: fields => fields };
const url = 'https://user.example.test/echo';
function wire(body = new Uint8Array(), method = 'POST', headers = new Headers()) {
  return Buffer.concat([Buffer.from(method), encodeHeaders(headers), body].map(value => {
    const length = Buffer.alloc(4); length.writeUInt32LE(value.length);
    return Buffer.concat([length, value]);
  }));
}
const run = (binding, bytes = wire(), options = 'example:50:0', signal) =>
  performDispatch(binding, url, bytes, options, helpers, signal);

test('per-call native-shaped get/fetch preserves receivers, policy, HTTP bytes and response status', async () => {
  let calls = 0;
  const target = { async fetch(request) {
    assert.equal(this, target);
    assert.equal(request.redirect, 'manual');
    assert.equal(request.url, url);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('x-test'), 'owned');
    return new Response(await request.arrayBuffer(), { status: 201, headers: { 'x-result': 'yes' } });
  } };
  const namespace = { get(name, args, options) {
    assert.equal(this, namespace); calls++;
    assert.equal(name, 'example'); assert.deepEqual(args, {});
    assert.deepEqual(options, { limits: { cpuMs: 50, subRequests: 0 } });
    return target;
  } };
  const bytes = wire(Buffer.from([0, 1, 127, 128, 255]), 'POST', new Headers({ 'x-test': 'owned' }));
  const pending = run(namespace, bytes);
  bytes.fill(0);
  const result = await pending;
  assert.equal(result.bytes[0], '201');
  assert.deepEqual(result.bytes[2], new Uint8Array([0, 1, 127, 128, 255]));
  assert.equal(calls, 1);
});

test('invalid targets, limits, URLs, methods, bodies and upgrade requests fail before lookup', async () => {
  let calls = 0;
  const namespace = { get() { calls++; throw new Error('must not look up'); } };
  for (const options of ['', ':50:0', 'bad.name:50:0', 'a'.repeat(64) + ':50:0',
    'a:0:0', 'a:30001:0', 'a:50:1001', 'a:50:00', 'a:50:0\n']) await assert.rejects(run(namespace, undefined, options));
  for (const address of ['', 'ftp://example.test/', 'https://user:pass@example.test/', 'x'.repeat(65537)])
    await assert.rejects(performDispatch(namespace, address, wire(), 'example:50:0', helpers));
  for (const bytes of [new Uint8Array(), wire(Buffer.alloc(1048577)), wire(Buffer.alloc(0), 'A'.repeat(33)),
    wire(Buffer.alloc(0), 'POST', new Headers({ upgrade: 'websocket' }))]) await assert.rejects(run(namespace, bytes));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(namespace, undefined, undefined, controller.signal));
  await assert.rejects(run(namespace, undefined, undefined, {}));
  assert.equal(calls, 0);
});

test('lookup/fetch failures do not retry; statuses and redirects are preserved without following', async () => {
  let calls = 0;
  await assert.rejects(run({ get() { calls++; throw new Error('missing'); } }), /missing/);
  assert.equal(calls, 1);
  await assert.rejects(run({ get: () => null }));
  await assert.rejects(run({ get: () => ({ fetch() { throw new Error('fetch failed'); } }) }), /fetch failed/);
  await assert.rejects(run({ get: () => ({ fetch: () => Promise.reject(new Error('async failure')) }) }), /async failure/);
  for (const status of [302, 404, 503]) {
    const result = await run({ get: () => ({ fetch: () => new Response('body', { status, headers: { location: 'https://elsewhere.invalid/' } }) }) });
    assert.equal(result.bytes[0], String(status));
  }
  await assert.rejects(run({ get: () => ({ fetch: () => ({ status: 200 }) }) }));
});

test('response caps and abort cancel streams without waiting for stalled cleanup', async () => {
  let canceled = 0;
  const oversized = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1048577)); },
    cancel() { canceled++; return new Promise(() => {}); } }));
  await assert.rejects(run({ get: () => ({ fetch: oversized }) }), /body exceeds limit/);
  assert.equal(canceled, 1);
  const controller = new AbortController();
  await assert.rejects(run({ get: () => ({ fetch() {
    controller.abort();
    return new Response(new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } }, { highWaterMark: 0 }));
  } }) }, undefined, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(canceled, 2);
  const lookupAbort = new AbortController();
  let fetched = false;
  await assert.rejects(run({ get() {
    lookupAbort.abort();
    return { fetch() { fetched = true; return new Response('unexpected'); } };
  } }, undefined, undefined, lookupAbort.signal), { name: 'AbortError' });
  assert.equal(fetched, false);
  const during = new AbortController();
  let requestSignal;
  const pending = run({ get: () => ({ fetch(request) {
    requestSignal = request.signal;
    return new Response(new ReadableStream({ cancel() { canceled++; } }, { highWaterMark: 0 }));
  } }) }, undefined, undefined, during.signal);
  await Promise.resolve(); during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
  assert.equal(canceled, 3);
  const recovered = await run({ get: () => ({ fetch: () => new Response(new Uint8Array(1048576)) }) }, wire(new Uint8Array(1048576 - 16)), 'max:30000:1000');
  assert.equal(recovered.bytes[2].byteLength, 1048576);
});
