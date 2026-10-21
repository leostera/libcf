import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createWorker } from '../lib/runtime.mjs';

function fixture({ pullError, cleanupError, eof = false, status = 200, afterBegin } = {}) {
  let host, pointer = 8, pulls = 0, cancellations = 0;
  const cpp = {
    HEAPU8: new Uint8Array(65536),
    _malloc(size) { const result = pointer; pointer += size; return result; },
    _free() {}, _libcf_cancel() {},
    _libcf_request_head(size) { return this._malloc(size); },
    _libcf_request_body(size) { return this._malloc(Math.max(size, 1)); },
    _libcf_http(id) {
      if (id === 1) { host.streamBegin(id, status); afterBegin?.(); }
      else host.finish(id, 200, new TextEncoder().encode('next request'));
    },
    _libcf_stream_pull(id) {
      pulls++;
      if (pullError) throw pullError;
      const done = eof && pulls > 1;
      host.streamEmit(id, done ? new Uint8Array() : new Uint8Array([1, 2, 3]), done);
    },
    _libcf_stream_cancel() {
      cancellations++;
      if (cleanupError) throw cleanupError;
    },
  };
  const worker = createWorker(async options => { host = options.libcfHost; return cpp; }, null);
  return {
    fetch: signal => worker.fetch(new Request('https://example.test/', {signal}), {}, {}),
    pulls: () => pulls, cancellations: () => cancellations,
    assertReleased() {
      // Observe removal through the existing host boundary, without adding a
      // production map-inspection API. A stale controller gives a different error.
      assert.throws(() => host.streamEmit(1, new Uint8Array([9]), false), /stream has no active pull/);
    },
  };
}

for (const cleanupTrap of [false, true]) {
  test(`pull failure retains its primary error and releases controller, cleanup trap=${cleanupTrap}`, async () => {
    const primary = new Error('pull trap'), cleanup = new Error('cleanup trap');
    const app = fixture({pullError:primary,cleanupError:cleanupTrap ? cleanup : undefined});
    const response = await app.fetch();
    await assert.rejects(response.arrayBuffer(), error => error === primary);
    assert.equal(app.cancellations(), 1); app.assertReleased();
    assert.equal(await (await app.fetch()).text(), 'next request');
  });

  test(`explicit cancellation releases controller even when cleanup traps=${cleanupTrap}`, async () => {
    const cleanup = new Error('cleanup trap'), app = fixture({cleanupError:cleanupTrap ? cleanup : undefined});
    const controller = new AbortController();
    const response = await app.fetch(controller.signal); await tick();
    if (cleanupTrap) await assert.rejects(response.body.cancel('stop'), error => error === cleanup);
    else await response.body.cancel('stop');
    assert.equal(app.cancellations(), 1); app.assertReleased();
    // Neither a later incoming abort nor a second cancel disposes twice.
    controller.abort(new Error('after cancellation'));
    await response.body.cancel('again'); assert.equal(app.cancellations(), 1);
    assert.equal(await (await app.fetch()).text(), 'next request');
  });
}

test('normal stream EOF removes its controller and incoming abort listener', async () => {
  const controller = new AbortController();
  const app = fixture({eof:true}), response = await app.fetch(controller.signal);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1,2,3]));
  controller.abort(new Error('after EOF'));
  assert.equal(app.pulls(),2); assert.equal(app.cancellations(),0); app.assertReleased();
});

for (const cleanupTrap of [false,true]) {
  test(`incoming abort after headers releases source and preserves reason, cleanup trap=${cleanupTrap}`, async () => {
    const controller = new AbortController(), reason = new Error('client aborted');
    const app = fixture({cleanupError:cleanupTrap ? new Error('cleanup trap') : undefined});
    const response = await app.fetch(controller.signal), reader = response.body.getReader(); controller.abort(reason);
    await assert.rejects(reader.read(), error => error === reason);
    await assert.rejects(reader.cancel(), error => error === reason); reader.releaseLock();
    assert.equal(app.cancellations(),1); app.assertReleased();
    assert.equal(await (await app.fetch()).text(),'next request');
  });
}

test('incoming abort at stream handoff prevents the first native pull', async () => {
  const controller = new AbortController(), reason = new Error('handoff abort');
  const app = fixture({afterBegin:()=>controller.abort(reason)});
  const response = await app.fetch(controller.signal);
  assert.equal(app.cancellations(),1); assert.equal(app.pulls(),0); app.assertReleased();
  await assert.rejects(response.arrayBuffer(), error => error === reason);
});

test('invalid streaming response construction releases controller without masking its error', async () => {
  for (const status of [100,204,205,304]) {
    const app = fixture({status,cleanupError:new Error('cleanup trap')});
    await assert.rejects(app.fetch(), error => error instanceof TypeError || error instanceof RangeError);
    await tick(); assert.equal(app.cancellations(),1); app.assertReleased(); assert.equal(app.pulls(),0);
  }
});

test('JS pull queue prefetches one chunk and waits for further demand', async () => {
  // This same-isolate mock verifies ReadableStream queue behavior, NOT HTTP,
  // workerd transport backpressure, byte-bounded buffering or C++ trap recovery.
  const app = fixture(), response = await app.fetch(); await tick();
  assert.equal(app.pulls(),1);
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1,2,3]));
  await tick(); assert.equal(app.pulls(),2);
  await tick(); assert.equal(app.pulls(),2);
  await reader.cancel('done'); reader.releaseLock(); app.assertReleased();
});
