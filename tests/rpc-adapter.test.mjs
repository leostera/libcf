import test from 'node:test';
import assert from 'node:assert/strict';
import { performRpc } from '../lib/rpc.mjs';
const bytes = text => new TextEncoder().encode(text);
const call = (binding, body = '[]', signal, name = 'echo') => performRpc(304, binding, name, bytes(body), '', signal);

test('JSON arguments are owned, receiver preserved and object/promise results disposed once', async () => {
  let resolve, received, resultDisposals = 0, promiseDisposals = 0;
  const pending = new Promise(done => { resolve = done; });
  pending[Symbol.dispose] = () => { promiseDisposals++; };
  const binding = { echo(...args) { assert.equal(this, binding); received = args; return pending; } };
  const input = bytes('[{"key":"owned"}]');
  const operation = performRpc(304, binding, 'echo', input, '');
  input.fill(0);
  assert.deepEqual(received, [{ key: 'owned' }]);
  resolve({ ok: true, [Symbol.dispose]() { resultDisposals++; } });
  const result = await operation;
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.bytes)), { ok: true });
  assert.equal(resultDisposals, 1);
  assert.equal(promiseDisposals, 1);
});

test('invalid calls reject before provider property access', async () => {
  let reads = 0;
  const binding = new Proxy({}, { get() { reads++; throw Error('provider accessed'); } });
  for (const name of ['fetch', 'connect', 'dup', 'constructor', 'then', 'toString', 'alarm', 'webSocketMessage',
    'a\n', '_private', 'nested.method', '', 'a'.repeat(101)]) await assert.rejects(call(binding, '[]', undefined, name));
  for (const body of ['{}', 'null', 'invalid', JSON.stringify(Array(33).fill(null))]) await assert.rejects(call(binding, body));
  await assert.rejects(call(binding, '[]', AbortSignal.abort()));
  await assert.rejects(call(binding, '[]', {}));
  await assert.rejects(performRpc(303, binding, 'echo', bytes('[]'), ''));
  await assert.rejects(performRpc(304, binding, 'echo', bytes('[]'), 'extra'));
  assert.equal(reads, 0);
});

test('unsupported results still release both ownership scopes', async () => {
  class Capability {}
  let resultDisposals = 0, promiseDisposals = 0;
  const result = { target: new Capability(), [Symbol.dispose]() { resultDisposals++; } };
  const pending = Promise.resolve(result);
  pending[Symbol.dispose] = () => { promiseDisposals++; };
  await assert.rejects(call({ echo: () => pending }), /prototype/);
  assert.equal(resultDisposals, 1);
  assert.equal(promiseDisposals, 1);
});

test('abort disposes the promise but drains and releases a late successful result', async () => {
  const abort = new AbortController();
  let resolve, resultDisposals = 0, promiseDisposals = 0;
  const pending = new Promise(done => { resolve = done; });
  pending[Symbol.dispose] = () => { promiseDisposals++; };
  const operation = call({ echo: () => pending }, '[]', abort.signal);
  abort.abort();
  assert.equal(promiseDisposals, 1);
  resolve({ [Symbol.dispose]() { resultDisposals++; } });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(promiseDisposals, 1);
  assert.equal(resultDisposals, 1);
});

test('abort cleanup traps do not escape the event listener or skip late-result release', async () => {
  const abort = new AbortController();
  let resolve, released = 0;
  const pending = new Promise(done => { resolve = done; });
  pending[Symbol.dispose] = () => { throw Error('cleanup failed'); };
  const operation = call({ echo: () => pending }, '[]', abort.signal);
  assert.doesNotThrow(() => abort.abort());
  resolve({ [Symbol.dispose]() { released++; } });
  await assert.rejects(operation, /cleanup failed/);
  assert.equal(released, 1);
});

test('provider failures and disposer failures are not successful RPC calls', async () => {
  const pending = Promise.reject(Error('provider failed'));
  let disposed = 0;
  pending[Symbol.dispose] = () => { disposed++; };
  await assert.rejects(call({ echo: () => pending }), /provider failed/);
  assert.equal(disposed, 1);
  await assert.rejects(call({ echo: () => ({ [Symbol.dispose]() { throw Error('result cleanup failed'); } }) }), /result cleanup failed/);
  await assert.rejects(call({}));
});
