import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performServiceTcp } from '../lib/service-tcp.mjs';
const invoke = (binding, body = Uint8Array.of(0, 128, 255), options = '1000:1048576', signal) =>
  performServiceTcp(binding, 'echo.invalid:1234', body, options, signal);

function fixture(overrides = {}) {
  const stream = new TransformStream();
  let closes = 0;
  const socket = { readable: stream.readable, writable: stream.writable,
    opened: Promise.resolve({}), closed: new Promise(() => {}),
    close() { closes++; }, ...overrides };
  const binding = { connect(address, options) {
    assert.equal(this, binding);
    assert.deepEqual(address, { hostname: 'echo.invalid', port: 1234 });
    assert.deepEqual(options, { secureTransport: 'off', allowHalfOpen: true });
    return socket;
  } };
  return { binding, socket, closes: () => closes };
}

test('duplex exchange owns input, reads concurrently with backpressured writes, and closes once', async () => {
  for (const size of [0, 5, 1048576]) {
    const body = new Uint8Array(size).fill(255);
    const peer = fixture();
    const pending = invoke(peer.binding, body);
    body.fill(1);
    const reply = await pending;
    assert.equal(reply.status, 0);
    assert.deepEqual(reply.bytes, new Uint8Array(size).fill(255));
    assert.equal(peer.closes(), 1);
  }
});

test('parse all fields and pre-abort before connecting', async () => {
  let calls = 0;
  const binding = { connect() { calls++; return fixture().socket; } };
  for (const address of ['', 'x:0', 'x:65536', 'x:01', 'x:1\n', '-x:1', 'x-:1', '[::1]:1', 'x'.repeat(254) + ':1'])
    await assert.rejects(performServiceTcp(binding, address, new Uint8Array(), '1000:10'));
  for (const options of ['', '0:1', '60001:1', '1:0', '1:1048577', '1:1\n', '01:1'])
    await assert.rejects(invoke(binding, new Uint8Array(), options));
  await assert.rejects(invoke(binding, new Uint8Array(1048577)));
  await assert.rejects(invoke(binding, [], '1000:1'));
  await assert.rejects(invoke(binding, new Uint8Array(), '1000:1', {}));
  const aborted = AbortSignal.abort(new Error('already gone'));
  await assert.rejects(invoke(binding, new Uint8Array(), '1000:1', aborted), /already gone/);
  assert.equal(calls, 0);
});

test('reply overflow cancels the exchange without retries', async () => {
  const peer = fixture();
  await assert.rejects(invoke(peer.binding, Uint8Array.of(1, 2), '1000:1'), /body exceeds limit/);
  assert.equal(peer.closes(), 1);
});

test('connect/open/closed/write failures propagate and do not wait for cleanup', async () => {
  let calls = 0;
  await assert.rejects(invoke({ connect() { calls++; throw new Error('connect failed'); } }), /connect failed/);
  assert.equal(calls, 1);
  for (const overrides of [
    { opened: Promise.reject(new Error('open failed')) },
    { closed: Promise.reject(new Error('closed failed')) },
    { writable: new WritableStream({ write() { throw new Error('write failed'); } }) },
  ]) {
    const peer = fixture(overrides);
    await assert.rejects(invoke(peer.binding), /(?:open|closed|write) failed/);
    assert.equal(peer.closes(), 1);
  }
  await assert.rejects(invoke({}), /unavailable/);
});

test('deadline covers opening and stalled writes, even when close never settles', { timeout: 5000 }, async () => {
  for (const overrides of [
    { opened: new Promise(() => {}) },
    { writable: new WritableStream({ write() { return new Promise(() => {}); } }) },
    { readable: new ReadableStream(), writable: new WritableStream() },
  ]) {
    let closes = 0;
    const peer = fixture({ ...overrides, close() { closes++; return new Promise(() => {}); } });
    await assert.rejects(invoke(peer.binding, Uint8Array.of(1), '20:10'), error => error.name === 'TimeoutError');
    assert.equal(closes, 1);
  }
});

test('synchronous abort inside connect still closes the newly returned socket', async () => {
  const controller = new AbortController();
  const peer = fixture();
  const binding = { connect() { controller.abort(new Error('connect aborted')); return peer.socket; } };
  await assert.rejects(invoke(binding, new Uint8Array(), '1000:10', controller.signal), /connect aborted/);
  assert.equal(peer.closes(), 1);
});

test('abort closes an opening socket; late opening cannot begin writing', async () => {
  const opened = Promise.withResolvers();
  const controller = new AbortController();
  let writes = 0;
  const peer = fixture({ opened: opened.promise,
    writable: new WritableStream({ write() { writes++; } }) });
  const pending = invoke(peer.binding, Uint8Array.of(1), '1000:10', controller.signal);
  controller.abort(new Error('caller gone'));
  await assert.rejects(pending, /caller gone/);
  opened.resolve({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.equal(peer.closes(), 1);
});
