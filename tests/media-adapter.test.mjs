import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performMediaFrame } from '../lib/media.mjs';
import { png } from '../examples/images/test/fixtures.mjs';

const options = '128:128:5000';
const frame = (binding, body = new Uint8Array([0, 128, 255]), limits = options, signal) =>
  performMediaFrame(binding, '', body, limits, signal);
const response = () => new Response(png, { headers: { 'content-type': 'image/png' } });
function provider(respond = response, inspect = () => {}) {
  const binding = { input(stream) {
    assert.equal(this, binding);
    inspect(stream);
    const transformer = { transform(config) {
      assert.equal(this, transformer);
      assert.deepEqual(config, { width: 128, height: 128, fit: 'contain' });
      const generator = { output(config) {
        assert.equal(this, generator);
        assert.deepEqual(config, { mode: 'frame', time: '0s', format: 'png' });
        const result = { response() { assert.equal(this, result); return respond(stream); } };
        return result;
      } };
      return generator;
    } };
    return transformer;
  } };
  return binding;
}

test('single-use native shape, preserved receivers, owned input/output and concurrent calls', async () => {
  let calls = 0;
  const binding = provider(async stream => {
    ++calls;
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    assert.deepEqual([...bytes], [0, 128, 255]);
    return response();
  });
  const input = new Uint8Array([0, 128, 255]);
  const pending = frame(binding, input);
  input.fill(42);
  const result = await pending;
  assert.equal(result.status, 0);
  assert.deepEqual(result.bytes, new Uint8Array(png));
  result.bytes.fill(0);
  await Promise.all(Array.from({ length: 8 }, async () => {
    assert.deepEqual((await frame(binding)).bytes, new Uint8Array(png));
  }));
  assert.equal(calls, 9);
});

test('invalid keys, wire, dimensions, duration and signals fail before provider invocation', async () => {
  let calls = 0;
  const binding = { input() { ++calls; } };
  for (const limits of ['', '0:128:1', '9:128:1', '513:128:1', '128:9:1', '128:513:1',
    '128:128:0', '128:128:60001', '128:128:1\n', '0128:128:1', '128:128:1.5', '128:128:-1'])
    await assert.rejects(frame(binding, new Uint8Array([1]), limits));
  for (const input of [null, [], new Uint8Array(), new Uint8Array(1048577)])
    await assert.rejects(frame(binding, input));
  await assert.rejects(performMediaFrame(binding, 'unexpected', new Uint8Array([1]), options));
  await assert.rejects(frame(binding, undefined, options, {}));
  await assert.rejects(frame(binding, undefined, options, AbortSignal.abort(new Error('pre-aborted'))), /pre-aborted/);
  assert.equal(calls, 0);
  await assert.rejects(frame({}), /binding unavailable/);
});

test('bad status/MIME and oversized output are discarded once without awaiting stalled cleanup', async () => {
  for (const kind of ['status', 'mime', 'overflow']) {
    let canceled = 0;
    const stream = new ReadableStream({
      start(controller) { if (kind === 'overflow') controller.enqueue(new Uint8Array(1048577)); },
      cancel() { ++canceled; return new Promise(() => {}); },
    });
    const binding = provider(() => new Response(stream, { status: kind === 'status' ? 503 : 200,
      headers: { 'content-type': kind === 'mime' ? 'video/mp4' : 'image/png' } }));
    await assert.rejects(frame(binding), kind === 'overflow' ? /body exceeds limit/ : /invalid Media frame response/);
    assert.equal(canceled, 1);
    assert.equal(stream.locked, false);
  }
  for (const body of [null, new Uint8Array([1]), new Uint8Array(8)])
    await assert.rejects(frame(provider(() => new Response(body, { headers: { 'content-type': 'image/png' } }))));
  await assert.rejects(frame(provider(() => ({}))), /invalid Media frame response/);
});

test('local deadline observes and cancels a late response without native signal options', async () => {
  let resolve, input, canceled = 0;
  const binding = provider(() => new Promise(done => { resolve = done; }), stream => { input = stream; });
  await assert.rejects(frame(binding, undefined, '128:128:1'), { name: 'TimeoutError' });
  const reader = input.getReader();
  try { assert.equal((await reader.read()).done, true); }
  finally { reader.releaseLock(); }
  resolve(new Response(new ReadableStream({ cancel() { ++canceled; } }), { headers: { 'content-type': 'image/png' } }));
  await nextTurn();
  assert.equal(canceled, 1);
});

test('request abort cancels an active reader and suppresses a late provider rejection', async () => {
  let canceled = 0, started;
  const reading = new Promise(resolve => { started = resolve; });
  const stream = new ReadableStream({ pull() { started(); }, cancel() { ++canceled; } }, { highWaterMark: 0 });
  const controller = new AbortController();
  const pending = frame(provider(() => new Response(stream, { headers: { 'content-type': 'image/png' } })), undefined, options, controller.signal);
  await reading;
  controller.abort(new Error('request stopped'));
  await assert.rejects(pending, /request stopped/);
  await nextTurn();
  assert.equal(canceled, 1);
  assert.equal(stream.locked, false);
  let reject;
  await assert.rejects(frame(provider(() => new Promise((_, fail) => { reject = fail; })), undefined, '128:128:1'), { name: 'TimeoutError' });
  reject(new Error('late native failure'));
  await nextTurn();
  assert.deepEqual((await frame(provider())).bytes, new Uint8Array(png));
});

test('dimension/timeout endpoints and exact output cap are accepted without claiming PNG decoding', async () => {
  const bytes = new Uint8Array(1048576);
  bytes.set(png);
  const binding = { input() { return { transform(config) {
    assert.deepEqual(config, { width: 10, height: 512, fit: 'contain' });
    return { output() { return { response() {
      return new Response(bytes, { headers: { 'content-type': 'Image/PNG; charset=binary' } });
    } }; } };
  } }; } };
  assert.deepEqual((await frame(binding, new Uint8Array(1048576), '10:512:60000')).bytes, bytes);
});

test('deadline also covers output consumption; cleanup does not replace provider failure', async () => {
  let canceled = 0;
  const binding = provider(() => new Response(new ReadableStream({ cancel() { ++canceled; } }), {
    headers: { 'content-type': 'image/png' },
  }));
  await assert.rejects(frame(binding, undefined, '128:128:1'), { name: 'TimeoutError' });
  await nextTurn();
  assert.equal(canceled, 1);
  class BrokenCleanupResponse extends Response { get body() { throw new Error('cleanup failed'); } }
  await assert.rejects(frame(provider(() => new BrokenCleanupResponse(null, { status: 503 }))), /invalid Media frame response/);
  await assert.rejects(frame(provider(() => { throw new Error('native failure'); })), /native failure/);
});

test('external signal listener is removed on success, provider failure and timeout', async () => {
  for (const respond of [response, () => { throw new Error('failure'); }, () => new Promise(() => {})]) {
    const { signal } = new AbortController();
    const listeners = new Set();
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options); };
    signal.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener); };
    await frame(provider(respond), undefined, '128:128:5', signal).catch(() => {});
    assert.equal(listeners.size, 0);
  }
});

test('abort during builder creation prevents subsequent native methods', async () => {
  const controller = new AbortController();
  let transforms = 0;
  const binding = { input() {
    controller.abort(new Error('synchronous abort'));
    return { transform() { ++transforms; } };
  } };
  await assert.rejects(frame(binding, undefined, options, controller.signal), /synchronous abort/);
  assert.equal(transforms, 0);
});
