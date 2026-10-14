import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performAi } from '../lib/ai.mjs';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const model = '@cf/model';
const invoke = (binding, body = bytes({}), signal) => performAi(binding, model, body, '', signal);

test('AI uses raw responses, owns parsed input before await, and preserves receiver/signal', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const input = bytes({ prompt: 'héllo', stream: false });
  const binding = { async run(name, parsed, options) {
    assert.equal(this, binding); assert.equal(name, model);
    assert.deepEqual(options, { returnRawResponse: true, signal: controller.signal });
    await pending;
    return Response.json({ parsed });
  } };
  const result = invoke(binding, input, controller.signal);
  input.fill(0); release();
  const reply = await result;
  assert.equal(reply.status, 0);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(reply.bytes)), { parsed: { prompt: 'héllo', stream: false } });
});

test('invalid model, options, input shape/size/depth, streaming and pre-abort never invoke AI', async () => {
  let calls = 0;
  const binding = { async run() { calls++; return Response.json({}); } };
  for (const name of ['', 'bad\n', '/model', 'x'.repeat(257), 'bad space'])
    await assert.rejects(performAi(binding, name, bytes({}), ''), /model/);
  await assert.rejects(performAi(binding, model, bytes({}), '{}'), /options/);
  await assert.rejects(performAi(binding, model, bytes({}), '', {}), /signal/);
  for (const value of [null, [], true, 1, { stream: true }, { stream: 'true' }, { stream: null }])
    await assert.rejects(invoke(binding, bytes(value)));
  for (const value of [new Uint8Array(), new Uint8Array(1048577), Uint8Array.of(255),
    new TextEncoder().encode('['.repeat(33) + '0' + ']'.repeat(33))])
    await assert.rejects(invoke(binding, value));
  const controller = new AbortController(); controller.abort(new Error('pre-aborted'));
  await assert.rejects(invoke(binding, bytes({}), controller.signal), /pre-aborted/);
  await assert.rejects(invoke({}), /unavailable/);
  assert.equal(calls, 0, 'invalid input must not start inference');
});

test('provider errors are not retried; rejected response bodies are canceled without logging contents', async () => {
  let calls = 0; let canceled = 0;
  await assert.rejects(invoke({ async run() {
    calls++;
    return new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 429 });
  } }), /HTTP 429/);
  assert.equal(calls, 1); assert.equal(canceled, 1);
  const failure = new Error('provider rejected');
  await assert.rejects(invoke({ async run() { calls++; throw failure; } }), error => error === failure);
  assert.equal(calls, 2);
});

test('raw result type, content type, JSON syntax/depth and body bounds are enforced', async () => {
  for (const response of [
    {}, new Response('{}'), new Response('event', { headers: { 'content-type': 'text/event-stream' } }),
    new Response('bad JSON', { headers: { 'content-type': 'application/json' } }),
    new Response(Uint8Array.of(255), { headers: { 'content-type': 'application/json' } }),
    new Response('1e999', { headers: { 'content-type': 'application/json' } }),
    Response.json({ value: 'x'.repeat(1048576) }),
    new Response('['.repeat(33) + '0' + ']'.repeat(33), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(invoke({ async run() { return response; } }));
  const reply = await invoke({ async run() {
    return new Response('{"value":null}', { headers: { 'content-type': 'application/example+json; charset=utf-8' } });
  } });
  assert.deepEqual(reply.bytes, bytes({ value: null }));
});

test('late response after abort is canceled rather than returned', async () => {
  let finish; let canceled = 0;
  const controller = new AbortController();
  const pending = invoke({ run() { return new Promise(resolve => { finish = resolve; }); } }, bytes({}), controller.signal);
  controller.abort(new Error('request gone'));
  finish(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await assert.rejects(pending, /request gone/);
  assert.equal(canceled, 1);
});

test('stalled bodies abort without waiting for a hanging cancellation promise', { timeout: 5000 }, async () => {
  const started = Promise.withResolvers();
  let canceled = 0;
  const controller = new AbortController();
  const body = new ReadableStream({
    pull() { started.resolve(); },
    cancel() { canceled++; return new Promise(() => {}); },
  });
  const pending = invoke({ async run() {
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  } }, bytes({}), controller.signal);
  await started.promise;
  controller.abort(new Error('stalled body aborted'));
  await assert.rejects(pending, /stalled body aborted/);
  assert.equal(canceled, 1);
});

test('unexpected streaming return is canceled without waiting for cleanup', { timeout: 5000 }, async () => {
  let canceled = 0;
  await assert.rejects(invoke({ async run() {
    return new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } });
  } }), /raw response/);
  assert.equal(canceled, 1);
});
