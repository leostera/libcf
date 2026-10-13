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

test('exact byte limit returns owned bytes and releases the reader without cancellation', async () => {
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([0, 255])); controller.close(); },
    cancel() { assert.fail('must not cancel a complete bounded body'); },
  });
  assert.deepEqual(await readBounded(body, 2), new Uint8Array([0, 255]));
  assert.equal(body.locked, false);
});
