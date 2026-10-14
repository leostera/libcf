import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createWorker } from '../lib/runtime.mjs';

function fixture({ pullError, cleanupError, eof = false } = {}) {
  let host, pointer = 8, pulls = 0, cancellations = 0;
  const cpp = {
    HEAPU8: new Uint8Array(65536),
    _malloc(size) { const result = pointer; pointer += size; return result; },
    _free() {}, _libcf_cancel() {},
    _libcf_http(id) {
      if (id === 1) host.streamBegin(id, 200);
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
    fetch: () => worker.fetch(new Request('https://example.test/'), {}, {}),
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
    const response = await app.fetch(); await tick();
    if (cleanupTrap) await assert.rejects(response.body.cancel('stop'), error => error === cleanup);
    else await response.body.cancel('stop');
    assert.equal(app.cancellations(), 1); app.assertReleased();
    // A closed stream does not dispose its source a second time.
    await response.body.cancel('again'); assert.equal(app.cancellations(), 1);
    assert.equal(await (await app.fetch()).text(), 'next request');
  });
}

test('normal stream EOF removes its controller', async () => {
  const app = fixture({eof:true}), response = await app.fetch();
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1,2,3]));
  assert.equal(app.pulls(),2); assert.equal(app.cancellations(),0); app.assertReleased();
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
