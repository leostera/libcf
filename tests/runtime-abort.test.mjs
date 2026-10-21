import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorker } from '../lib/runtime.mjs';
const encoder = new TextEncoder();
const bytes = text => encoder.encode(text);
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = signal => new Request('https://example.test/', { signal });
const noCpp = () => new Proxy({}, { get(_, key) {
  if (key === 'then') return undefined;
  throw new Error(`C++ must not be entered: ${String(key)}`);
} });
function fixture(start, cancel = () => {}, complete = () => {}) {
  let host;
  let pointer = 8;
  let completions = 0;
  const cpp = {
    HEAPU8: new Uint8Array(65536),
    _malloc(length) { const value = pointer; pointer += length; return value; },
    _free() {}, _libcf_cancel: cancel,
    _libcf_request_head(length) { return this._malloc(length); },
    _libcf_request_body(length) { return this._malloc(Math.max(length, 1)); },
    _libcf_operation_reply(_, length) { return this._malloc(length); },
    _libcf_http(id) { start(host, id); },
    _libcf_operation_done() { completions++; complete(); },
    _libcf_fetch_done() { completions++; complete(); },
  };
  return {
    worker: createWorker(async options => { host = options.libcfHost; return cpp; }, null),
    completions: () => completions,
  };
}

test('pre-aborted input cancels its body without initializing or entering Wasm', async () => {
  const controller = new AbortController();
  controller.abort();
  let factories = 0;
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const worker = createWorker(async () => { factories++; return noCpp(); }, null);
  const input = new Request('https://example.test/', { method: 'POST', body, duplex: 'half', signal: controller.signal });
  assert.equal((await worker.fetch(input, {}, {})).status, 408);
  assert.equal(factories, 0);
  assert.equal(cancelled, true);
});

test('abort during initialization never enters C++, including a late initialization failure', async () => {
  for (const fail of [false, true]) {
    const controller = new AbortController();
    let settle;
    const worker = createWorker(() => new Promise((resolve, reject) => {
      settle = () => fail ? reject(new Error('initialization failed')) : resolve(noCpp());
    }), null);
    const pending = worker.fetch(request(controller.signal), {}, {});
    controller.abort();
    settle();
    assert.equal((await pending).status, 408);
  }
});

test('abort interrupts a stalled input reader and releases its lock', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    pull() { controller.abort(); },
    cancel() { cancelled = true; return Promise.reject(new Error('cleanup failure')); },
  }, { highWaterMark: 0 });
  const worker = createWorker(async () => noCpp(), null);
  const input = new Request('https://example.test/', { method: 'POST', body, duplex: 'half', signal: controller.signal });
  assert.equal((await worker.fetch(input, {}, {})).status, 408);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  await tick(); // Rejected cancellation must not become an unhandled rejection.
});

test('cancelled invocation cannot dispatch queued binding or Assets work; next invocation still works', async () => {
  const controller = new AbortController();
  let operations = 0;
  let assets = 0;
  const app = fixture((host, id) => {
    if (id !== 1) { host.finish(id, 200, bytes('ok')); return; }
    host.operation(1, id, 128, bytes('LIMITER'), bytes('fixture'), bytes(''), bytes(''));
    host.fetch(2, id, bytes('/asset'));
    controller.abort();
  });
  const env = {
    LIMITER: { async limit() { operations++; return { success: true }; } },
    ASSETS: { async fetch() { assets++; return new Response('unexpected'); } },
  };
  assert.equal((await app.worker.fetch(request(controller.signal), env, {})).status, 408);
  await tick();
  assert.equal(operations, 0);
  assert.equal(assets, 0);
  assert.equal(app.completions(), 0);
  assert.equal(await (await app.worker.fetch(new Request('https://example.test/'), env, {})).text(), 'ok');
});

test('already-started operation may finish, but cannot resume cancelled C++', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let started;
  let finish;
  const ready = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  const app = fixture((host, id) => host.operation(1, id, 128, bytes('LIMITER'), bytes('fixture'), bytes(''), bytes('')));
  const pending = app.worker.fetch(request(controller.signal), { LIMITER: { limit() { started(); return result; } } }, {});
  await ready;
  controller.abort();
  assert.equal((await pending).status, 408);
  finish({ success: true });
  await tick();
  assert.equal(app.completions(), 0);
});

for (const cleanupTrap of [false, true]) {
  test(`foreground signal closes on normal return, including cleanup trap=${cleanupTrap}`, async () => {
    let forwarded;
    let finish;
    let cancelled = false;
    const result = new Promise(resolve => { finish = resolve; });
    const app = fixture((host, id) => {
      host.fetch(1, id, bytes('/asset'));
      // Let fetch dispatch, then finish C++ without awaiting that provider.
      queueMicrotask(() => host.finish(id, 200, bytes('ok')));
    }, () => { if (cleanupTrap) throw new Error('cleanup trap'); });
    const input = new Request('https://example.test/');
    const pending = app.worker.fetch(input, { ASSETS: { fetch(request) {
      forwarded = request;
      return result;
    } } }, {});
    if (cleanupTrap) await assert.rejects(pending, /cleanup trap/);
    else assert.equal(await (await pending).text(), 'ok');
    assert.equal(input.signal.aborted, false);
    assert.equal(forwarded.signal.aborted, true);
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 })));
    await tick();
    assert.equal(cancelled, true);
    assert.equal(app.completions(), 0);
  });
}

for (const kind of ['binding', 'assets']) {
  for (const cleanupTrap of [false, true]) {
    test(`${kind} completion trap settles the request with cleanup trap=${cleanupTrap}`, { timeout: 5000 }, async () => {
      let cleanups = 0;
      let signal;
      const app = fixture((host, id) => {
        if (kind === 'binding') host.operation(1, id, 128, bytes('LIMITER'), bytes('fixture'), bytes(''), bytes(''));
        else host.fetch(1, id, bytes('/asset'));
      }, () => {
        cleanups++;
        if (cleanupTrap) throw new Error('cleanup trap');
      }, () => { throw new Error('completion trap'); });
      const pending = app.worker.fetch(new Request('https://example.test/'), {
        LIMITER: { async limit() { return { success: true }; } },
        ASSETS: { async fetch(request) { signal = request.signal; return new Response('fixture'); } },
      }, {});
      await assert.rejects(pending, cleanupTrap ? /cleanup trap/ : /completion trap/);
      await tick();
      assert.equal(cleanups, 1);
      assert.equal(app.completions(), 1);
      if (signal) assert.equal(signal.aborted, true);
    });
  }
}

test('C++ cancellation trap rejects the invocation without escaping the abort listener', async () => {
  const controller = new AbortController();
  let dispatches = 0;
  const app = fixture((host, id) => {
    host.fetch(1, id, bytes('/asset'));
    controller.abort();
  }, () => { throw new Error('cancel trap'); });
  await assert.rejects(app.worker.fetch(request(controller.signal), { ASSETS: { fetch() { dispatches++; } } }, {}), /cancel trap/);
  await tick();
  assert.equal(dispatches, 0);
  assert.equal(app.completions(), 0);
});

test('late Assets response is cancelled rather than buffered after abort', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let started;
  let finish;
  let forwarded;
  let cancelled = false;
  const ready = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  const app = fixture((host, id) => host.fetch(1, id, bytes('/asset')));
  const pending = app.worker.fetch(request(controller.signal), { ASSETS: { fetch(input) {
    forwarded = input; started(); return result;
  } } }, {});
  await ready;
  controller.abort();
  assert.equal((await pending).status, 408);
  assert.equal(forwarded.signal.aborted, true);
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 })));
  await tick();
  assert.equal(cancelled, true);
  assert.equal(app.completions(), 0);
});
