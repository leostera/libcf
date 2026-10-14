import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { readBounded } from '../lib/body.mjs';

for (const kind of ['reject', 'throw', 'never-settle']) {
  test(`oversize releases its reader and preserves RangeError when cancellation will ${kind}`, async () => {
    let cancellations = 0;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(3)); },
      cancel(reason) {
        cancellations++;
        assert.equal(reason, 'body size limit');
        if (kind === 'throw') throw new Error('cleanup failed');
        if (kind === 'reject') return Promise.reject(new Error('cleanup failed'));
        return new Promise(() => {});
      },
    });
    let failure;
    const pending = readBounded(body, 2).catch(error => { failure = error; });
    await nextTurn();
    assert(failure instanceof RangeError, 'must settle without waiting for producer cleanup');
    assert.equal(failure.message, 'body exceeds limit');
    assert.equal(cancellations, 1);
    assert.equal(body.locked, false);
    await pending;
  });
}

test('copies each observed chunk before requesting another from a reusable producer buffer', async () => {
  const buffer = new Uint8Array(1);
  let next = 1;
  const body = new ReadableStream({
    pull(controller) {
      if (next > 3) { controller.close(); return; }
      buffer[0] = next++;
      controller.enqueue(buffer);
    },
  }, { highWaterMark: 0 });
  assert.deepEqual(await readBounded(body, 3), new Uint8Array([1, 2, 3]));
  assert.equal(body.locked, false);
});

test('empty chunks use no payload budget and growth returns an exact independent buffer', async () => {
  const source = new Uint8Array([99, 1, 2, 3, 99]);
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (pulls++ < 1000) controller.enqueue(new Uint8Array());
      else if (pulls === 1001) controller.enqueue(source.subarray(1, 4));
      else if (pulls === 1002) controller.enqueue(new Uint8Array([4, 5]));
      else controller.close();
    },
  }, { highWaterMark: 0 });
  const bytes = await readBounded(body, 10);
  source.fill(0);
  assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(bytes.buffer.byteLength, 5);
  assert.equal(body.locked, false);
  assert.deepEqual(await readBounded(new ReadableStream({ start(c) { c.close(); } }), 0), new Uint8Array());
});

test('invalid limits/signals fail before locking, and invalid chunks cancel without masking the error', async () => {
  const body = new ReadableStream();
  for (const limit of [-1, 0.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readBounded(body, limit), /invalid body byte limit/);
    assert.equal(body.locked, false);
  }
  await assert.rejects(readBounded(body, 2, {}), /invalid body signal/);
  assert.equal(body.locked, false);
  for (const value of ['abc', new Uint16Array([1]), { byteLength: 1 }, null]) {
    let canceled = 0;
    const invalid = new ReadableStream({
      start(controller) { controller.enqueue(value); },
      cancel() { canceled++; return new Promise(() => {}); },
    });
    await assert.rejects(readBounded(invalid), /body chunk must be Uint8Array/);
    assert.equal(canceled, 1);
    assert.equal(invalid.locked, false);
  }
});

test('pre-abort and blocked-read abort preserve cancellation reason and release ownership', async () => {
  for (const preAbort of [true, false]) {
    let canceled = 0;
    const controller = new AbortController();
    const body = new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } }, { highWaterMark: 0 });
    const reason = new Error('caller stopped');
    if (preAbort) controller.abort(reason);
    const pending = readBounded(body, 1, controller.signal);
    if (!preAbort) controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(canceled, 1);
    assert.equal(body.locked, false);
  }
});

test('exact byte limit returns owned bytes and releases the reader without cancellation', async () => {
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([0, 255])); controller.close(); },
    cancel() { assert.fail('must not cancel a complete bounded body'); },
  });
  assert.deepEqual(await readBounded(body, 2), new Uint8Array([0, 255]));
  assert.equal(body.locked, false);
});
