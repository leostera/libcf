import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performBrowserScreenshot } from '../lib/browser.mjs';
import { png } from '../examples/images/test/fixtures.mjs';

const encoder = new TextEncoder();
const options = '128:128:5000';
const screenshot = (binding, body = encoder.encode('<p>owned</p>'), limits = options, signal) =>
  performBrowserScreenshot(binding, '', body, limits, signal);
const response = () => new Response(png, { headers: { 'content-type': 'image/png' } });
const provider = (respond = response) => ({ quickAction: respond });

test('fixed documented options, preserved receiver and owned UTF-8 input/output', async () => {
  const html = '\uFEFF<p>é😀\0</p>';
  let calls = 0;
  const binding = { quickAction(action, config) {
    assert.equal(this, binding);
    assert.equal(action, 'screenshot');
    assert.deepEqual(config, {
      html, viewport: { width: 128, height: 128, deviceScaleFactor: 1 },
      screenshotOptions: { type: 'png', encoding: 'binary', fullPage: false, captureBeyondViewport: false },
      setJavaScriptEnabled: false, rejectRequestPattern: ['.*'], cacheTTL: 0, bestAttempt: false,
      gotoOptions: { timeout: 5000, waitUntil: 'domcontentloaded' }, actionTimeout: 5000,
    });
    ++calls; return response();
  } };
  const input = encoder.encode(html), pending = screenshot(binding, input);
  input.fill(42);
  const result = await pending;
  assert.equal(result.status, 0);
  assert.deepEqual(result.bytes, new Uint8Array(png));
  result.bytes.fill(0);
  await Promise.all(Array.from({ length: 8 }, async () => {
    assert.deepEqual((await screenshot(binding, encoder.encode(html))).bytes, new Uint8Array(png));
  }));
  assert.equal(calls, 9);
});

test('successful body getter is snapshotted once and borrowed binding is never disposed', async () => {
  let reads = 0;
  class ObservedResponse extends Response { get body() { ++reads; return super.body; } }
  const root = new ObservedResponse(png, { headers: { 'content-type': 'image/png' } });
  root.quickAction = () => root;
  root[Symbol.dispose] = () => { throw new Error('borrowed binding disposed'); };
  assert.deepEqual((await screenshot(root)).bytes, new Uint8Array(png));
  assert.equal(reads, 1);
});

test('invalid input, UTF-8, limits and signal reject before invocation', async () => {
  let calls = 0;
  const binding = provider(() => { ++calls; });
  for (const limits of ['', '0:1:1', '1:0:1', '513:1:1', '1:513:1', '1:1:0', '1:1:60001',
    '01:1:1', '1:1:1\n', '1:1:1.5', '1:1:-1']) await assert.rejects(screenshot(binding, undefined, limits));
  for (const input of [null, [], new Uint8Array(), new Uint8Array(65537),
    new Uint8Array([0xff]), new Uint8Array([0xed, 0xa0, 0x80]), new Uint8Array([0xf0, 0x9f])])
    await assert.rejects(screenshot(binding, input));
  await assert.rejects(performBrowserScreenshot(binding, 'url', encoder.encode('x'), options));
  await assert.rejects(screenshot(binding, undefined, options, {}));
  await assert.rejects(screenshot(binding, undefined, options, AbortSignal.abort(new Error('stopped'))), /stopped/);
  assert.equal(calls, 0);
  await assert.rejects(screenshot({}), /binding unavailable/);
});

test('exact SDK boundaries accepted without claiming PNG decoding or layout', async () => {
  const bytes = new Uint8Array(1048576); bytes.set(png);
  const result = await screenshot(provider((action, config) => {
    assert.equal(config.html.length, 65536);
    assert.deepEqual(config.viewport, { width: 1, height: 512, deviceScaleFactor: 1 });
    assert.equal(config.actionTimeout, 60000);
    return new Response(bytes, { headers: { 'content-type': 'Image/PNG; charset=binary' } });
  }), encoder.encode('x'.repeat(65536)), '1:512:60000');
  assert.deepEqual(result.bytes, bytes);
});

test('bad response and overflow cancel once without waiting for stalled cleanup', async () => {
  for (const kind of ['status', 'mime', 'overflow']) {
    let canceled = 0;
    const stream = new ReadableStream({
      start(controller) { if (kind === 'overflow') controller.enqueue(new Uint8Array(1048577)); },
      cancel() { ++canceled; return new Promise(() => {}); },
    });
    await assert.rejects(screenshot(provider(() => new Response(stream, {
      status: kind === 'status' ? 503 : 200,
      headers: { 'content-type': kind === 'mime' ? 'application/json' : 'image/png' },
    }))), kind === 'overflow' ? /body exceeds limit/ : /invalid Browser screenshot response/);
    assert.equal(canceled, 1); assert.equal(stream.locked, false);
  }
  for (const body of [null, new Uint8Array([1]), new Uint8Array(8)])
    await assert.rejects(screenshot(provider(() => new Response(body, { headers: { 'content-type': 'image/png' } }))));
  await assert.rejects(screenshot(provider(() => ({}))), /invalid Browser screenshot response/);
});

test('owned promises and roots live through reading, release once; borrowed binding stays alive', async () => {
  let promiseDisposed = 0, rootDisposed = 0;
  const root = response();
  root[Symbol.dispose] = () => { assert.equal(root.bodyUsed, true); ++rootDisposed; };
  const pending = Promise.resolve(root);
  pending[Symbol.dispose] = () => { assert.equal(root.bodyUsed, true); ++promiseDisposed; };
  const binding = provider(() => pending);
  binding[Symbol.dispose] = () => { throw new Error('borrowed binding disposed'); };
  await screenshot(binding);
  assert.equal(promiseDisposed, 1); assert.equal(rootDisposed, 1);
  let aliasDisposed = 0;
  const alias = response(); alias[Symbol.dispose] = () => { ++aliasDisposed; };
  await screenshot(provider(() => alias));
  assert.equal(aliasDisposed, 1);
});

test('deadline drains and discards late response, observes late rejection and permits recovery', async () => {
  let resolve, canceled = 0, disposed = 0;
  const pending = new Promise(done => { resolve = done; });
  pending[Symbol.dispose] = () => { ++disposed; };
  await assert.rejects(screenshot(provider(() => pending), undefined, '128:128:1'), { name: 'TimeoutError' });
  const late = new Response(new ReadableStream({ cancel() { ++canceled; } }), { headers: { 'content-type': 'image/png' } });
  late[Symbol.dispose] = () => { ++disposed; };
  resolve(late); await nextTurn();
  assert.equal(canceled, 1); assert.equal(disposed, 2);
  let reject;
  await assert.rejects(screenshot(provider(() => new Promise((_, fail) => { reject = fail; })), undefined, '128:128:1'), { name: 'TimeoutError' });
  reject(new Error('late failure')); await nextTurn();
  assert.deepEqual((await screenshot(provider())).bytes, new Uint8Array(png));
});

test('abort and deadline cover active body consumption', async () => {
  for (const abort of [true, false]) {
    let started, canceled = 0;
    const reading = new Promise(resolve => { started = resolve; });
    const stream = new ReadableStream({ pull() { started(); }, cancel() { ++canceled; } }, { highWaterMark: 0 });
    const controller = new AbortController();
    const operation = screenshot(provider(() => new Response(stream, { headers: { 'content-type': 'image/png' } })),
      undefined, abort ? options : '128:128:10', controller.signal);
    const check = assert.rejects(operation, { name: abort ? 'AbortError' : 'TimeoutError' });
    await reading;
    if (abort) controller.abort();
    await check; await nextTurn();
    assert.equal(canceled, 1); assert.equal(stream.locked, false);
  }
});

test('cleanup failure rejects success without replacing primary failures; listeners removed', async () => {
  for (const bad of [false, true]) {
    const root = bad ? new Response(null, { status: 503 }) : response();
    root[Symbol.dispose] = () => { throw new Error('cleanup failed'); };
    await assert.rejects(screenshot(provider(() => root)), bad ? /invalid Browser screenshot response/ : /cleanup failed/);
  }
  for (const respond of [response, () => { throw new Error('failure'); }, () => new Promise(() => {})]) {
    const { signal } = new AbortController(), listeners = new Set();
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options); };
    signal.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener); };
    await screenshot(provider(respond), undefined, '128:128:5', signal).catch(() => {});
    assert.equal(listeners.size, 0);
  }
});

test('synchronous abort still drains returned owned handles and never reads the body', async () => {
  const controller = new AbortController();
  let reads = 0, canceled = 0, disposed = 0;
  const root = new Response(new ReadableStream({ pull() { ++reads; }, cancel() { ++canceled; } }, { highWaterMark: 0 }),
    { headers: { 'content-type': 'image/png' } });
  root[Symbol.dispose] = () => { ++disposed; };
  await assert.rejects(screenshot(provider(() => { controller.abort(); return root; }), undefined, options, controller.signal), { name: 'AbortError' });
  await nextTurn();
  assert.equal(reads, 0); assert.equal(canceled, 1); assert.equal(disposed, 1);
});
