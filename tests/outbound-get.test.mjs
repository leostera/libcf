import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBoundHttpsPolicy } from '../lib/outbound-policy.mjs';
import { performBoundHttpsGet as perform } from '../lib/outbound-get.mjs';
const empty = new Uint8Array();
const policy = parseBoundHttpsPolicy(JSON.stringify(['mtls', 'vpc-service', 'vpc-network'].map((kind, i) => ({ kind, binding: 'B' + i, name: 'health', url: 'https://owned.invalid/health' }))));
const run = (binding, options = '5000', signal) => perform(binding, policy, 'mtls', 'B0', 'health', empty, options, signal);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('fresh manual GET, receiver preservation, empty/binary/maximum owned outputs', async () => {
  for (const [i, kind] of ['mtls', 'vpc-service', 'vpc-network'].entries()) {
    const binding = { fetch(request) {
      assert.equal(this, binding); assert.equal(request.url, 'https://owned.invalid/health');
      assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'manual'); assert.equal(request.body, null);
      assert.deepEqual([...request.headers], []); return new Response(new Uint8Array([0, 255, 128]));
    }, [Symbol.dispose]() { assert.fail('borrowed binding'); } };
    assert.deepEqual((await perform(binding, policy, kind, 'B' + i, 'health', empty, '60000')).bytes, new Uint8Array([0, 255, 128]));
  }
  assert.deepEqual(await run({ fetch: () => new Response(null) }), { status: 0, bytes: empty });
  assert.equal((await run({ fetch: () => new Response(new Uint8Array(1048576)) })).bytes.length, 1048576);
  let canceled = 0;
  await assert.rejects(run({ fetch: () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1048577)); }, cancel() { ++canceled; return new Promise(() => {}); } })) }), /body exceeds limit/);
  assert.equal(canceled, 1);
});

test('policy and request rejection precede method access; no redirect/header/error-body projection', async () => {
  const unavailable = { get fetch() { assert.fail('method accessed'); } };
  await assert.rejects(perform(unavailable, policy, 'vpc-network', 'B0', 'health', empty, '5000'));
  await assert.rejects(perform(unavailable, policy, 'mtls', 'B0', 'unknown', empty, '5000'));
  await assert.rejects(perform(unavailable, {}, 'mtls', 'B0', 'health', empty, '5000'));
  for (const options of ['', '0', '01', '1\n', '60001', 10]) await assert.rejects(run(unavailable, options));
  for (const body of [[], new Uint8Array(1)]) await assert.rejects(perform(unavailable, policy, 'mtls', 'B0', 'health', body, '5000'));
  await assert.rejects(run(unavailable, '5000', {}));
  await assert.rejects(run(unavailable, '5000', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(run({}), /unavailable/);
  let calls = 0, cancellations = 0;
  for (const status of [201, 204, 206, 301, 302, 303, 307, 308, 400, 401, 404, 429, 500]) {
    const response = new Response(null, { status });
    const stream = new ReadableStream({ cancel() { ++cancellations; } }, { highWaterMark: 0 });
    Object.defineProperty(response, 'body', { value: stream });
    Object.defineProperty(response, 'headers', { get() { assert.fail('headers read'); } });
    Object.defineProperty(response, 'url', { get() { assert.fail('URL used as identity'); } });
    await assert.rejects(run({ fetch() { ++calls; return response; } }), /unredirected 200/);
  }
  assert.equal(calls, 13); assert.equal(cancellations, 13);
  const redirected = new Response(null); Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(run({ fetch: () => redirected }), /unredirected 200/);
  for (const value of [null, undefined, {}, 'text']) await assert.rejects(run({ fetch: () => value }), /invalid outbound response/);
});

test('roots survive reading; body observed once; malformed children do not expand traversal', async () => {
  const released = []; let reads = 0, bodyReads = 0;
  const scratch = new Uint8Array([1, 2]);
  const stream = new ReadableStream({ pull(c) {
    assert.equal(released.length, 0);
    if (++reads === 1) c.enqueue(scratch);
    else if (reads === 2) { scratch.set([3, 4]); c.enqueue(scratch); } else c.close();
  } }, { highWaterMark: 0 });
  stream[Symbol.dispose] = () => { released.push('body'); scratch.fill(0); };
  const response = new Response(null); Object.defineProperty(response, 'body', { get() { ++bodyReads; return stream; } });
  response[Symbol.dispose] = () => released.push('response');
  const pending = Promise.resolve(response); pending[Symbol.dispose] = () => released.push('pending');
  assert.deepEqual((await run({ fetch: () => pending })).bytes, new Uint8Array([1, 2, 3, 4]));
  assert.equal(bodyReads, 1); assert.deepEqual(released, ['body', 'response', 'pending']);
  const child = new Response(null), parent = new Response(null); let disposed = 0;
  Object.defineProperty(child, 'body', { get() { assert.fail('recursive body traversal'); } }); child[Symbol.dispose] = () => ++disposed;
  Object.defineProperty(parent, 'body', { value: child });
  await assert.rejects(run({ fetch: () => parent }), /invalid outbound response body/); assert.equal(disposed, 1);
  const cleanup = new Response(null); cleanup[Symbol.dispose] = () => { throw new Error('cleanup'); };
  await assert.rejects(run({ fetch: () => cleanup }), /cleanup/);
  const primary = new Error('primary'), failed = new Response(new ReadableStream({ start(c) { c.error(primary); } }));
  failed[Symbol.dispose] = () => { throw new Error('secondary'); };
  await assert.rejects(run({ fetch: () => failed }), error => error === primary);
  const getter = new Response(null); let gets = 0;
  Object.defineProperty(getter, 'body', { get() { ++gets; throw primary; } });
  await assert.rejects(run({ fetch: () => getter }), error => error === primary); assert.equal(gets, 1);
});

test('deadline/abort cancel active readers and late bodies; producer cleanup cannot hold failure', async () => {
  for (const stage of ['fetch', 'body']) for (const mode of ['abort', 'timeout']) {
    let resolve, canceled = 0, pulls = 0, requestSignal;
    const stream = new ReadableStream({ pull() { ++pulls; return new Promise(() => {}); }, cancel() { ++canceled; return new Promise(() => {}); } }, { highWaterMark: 0 });
    const response = new Response(null); Object.defineProperty(response, 'body', { value: stream });
    const pending = new Promise(yes => { resolve = yes; }); const controller = new AbortController();
    const result = run({ fetch(request) { requestSignal = request.signal; return stage === 'fetch' ? pending : response; } }, mode === 'timeout' ? '5' : '5000', controller.signal);
    const rejected = assert.rejects(result, { name: mode === 'timeout' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode === 'abort') controller.abort(); await rejected;
    resolve(response); await tick(); assert(requestSignal.aborted); assert.equal(canceled, 1); assert.equal(pulls, stage === 'fetch' ? 0 : 1);
  }
  let reject; const pending = new Promise((_, no) => { reject = no; });
  await assert.rejects(run({ fetch: () => pending }, '5'), { name: 'TimeoutError' }); reject(new Error('late')); await tick();
  const controller = new AbortController(); let canceled = 0, reads = 0;
  const response = new Response(null), stream = new ReadableStream({ cancel() { ++canceled; throw new Error('late cancel'); } }, { highWaterMark: 0 });
  Object.defineProperty(response, 'body', { get() { ++reads; controller.abort(); return stream; } });
  await assert.rejects(run({ fetch: () => response }, '5000', controller.signal), { name: 'AbortError' });
  await tick(); assert.equal(reads, 1); assert.equal(canceled, 1);
  const synchronous = new AbortController(); let disposed = 0, canceledLate = 0;
  const late = new Response(null);
  Object.defineProperty(late, 'body', { value: new ReadableStream({ cancel() { ++canceledLate; } }, { highWaterMark: 0 }) });
  late[Symbol.dispose] = () => ++disposed;
  await assert.rejects(run({ fetch() { synchronous.abort(); return late; } }, '5000', synchronous.signal), { name: 'AbortError' });
  await tick(); assert.equal(canceledLate, 1); assert.equal(disposed, 1);
  const beforeInvoke = new AbortController();
  await assert.rejects(run({ get fetch() { beforeInvoke.abort(); return () => assert.fail('fetch after cancellation'); } }, '5000', beforeInvoke.signal), { name: 'AbortError' });
  const primary = Object.assign(new Error('provider failure'), { retryable: true }); let calls = 0;
  await assert.rejects(run({ fetch() { ++calls; throw primary; } }), error => error === primary && error.retryable); assert.equal(calls, 1);
});
