import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performSleep } from '../lib/timer.mjs';
function wire(value) { const data = new Uint8Array(4); new DataView(data.buffer).setUint32(0, value, true); return data; }
function clock() {
  let fire;
  const scheduled = [];
  const cleared = [];
  return { scheduled, cleared, fire: () => fire(),
    setTimeout(callback, delay) { scheduled.push(delay); fire = callback; return 0; },
    clearTimeout(id) { cleared.push(id); },
  };
}
test('sleep waits for the timer, accepts endpoint delays and clears handle zero', async () => {
  for (const delay of [0, 1, 60000]) {
    const timers = clock();
    let done = false;
    const pending = performSleep(wire(delay), undefined, timers).then(result => { done = true; return result; });
    await Promise.resolve();
    assert.equal(done, false);
    assert.deepEqual(timers.scheduled, [delay]);
    timers.fire();
    assert.deepEqual(await pending, { status: 0, bytes: new Uint8Array() });
    assert.deepEqual(timers.cleared, [0]);
  }
});
test('malformed wire and pre-abort do not schedule timers', async () => {
  const timers = clock();
  for (const body of [new Uint8Array(), new Uint8Array(5), wire(60001), wire(0xffffffff)])
    await assert.rejects(performSleep(body, undefined, timers));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(performSleep(wire(1), controller.signal, timers), { name: 'AbortError' });
  assert.deepEqual(timers.scheduled, []);
});
test('abort clears a pending timer and ignores a late callback', async () => {
  const timers = clock();
  const controller = new AbortController();
  const pending = performSleep(wire(60000), controller.signal, timers);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.deepEqual(timers.cleared, [0]);
  timers.fire();
  await Promise.resolve();
  assert.deepEqual(timers.cleared, [0]);
});
test('timer setup failure removes the signal listener', async () => {
  const controller = new AbortController();
  let listeners = 0;
  const signal = {
    throwIfAborted() { controller.signal.throwIfAborted(); },
    addEventListener(...args) { listeners++; controller.signal.addEventListener(...args); },
    removeEventListener(...args) { listeners--; controller.signal.removeEventListener(...args); },
  };
  await assert.rejects(performSleep(wire(1), signal, {
    setTimeout() { throw new Error('setup failed'); },
    clearTimeout() { assert.fail('no handle allocated'); },
  }), /setup failed/);
  assert.equal(listeners, 0);
});
