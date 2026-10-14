import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performAgentMemoryListCreatingProfile as perform } from '../lib/agent-memory.mjs';
const encoder = new TextEncoder();
const list = (binding, cursor = new Uint8Array(), options = '20:5000', signal) => perform(binding, 'owned-profile', cursor, options, signal);
const memory = () => ({ id: 'memory-猫', type: 'fact', summary: '\ufeffsummary\0', sessionId: null,
  createdAt: new Date(-1), updatedAt: new Date(1) });
const provider = (page = () => ({ memories: [memory()] })) => ({ getProfile() { return { list: page }; } });
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const text = () => { const length = u32(); const value = decoder.decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
  const optional = () => u32() ? text() : null;
  const time = () => { const value = Number(view.getBigInt64(offset, true)); offset += 8; return value; };
  const count = u32(), cursor = optional(), records = [];
  for (let i = 0; i < count; ++i) records.push({ id: text(), type: u32(), summary: text(), session: optional(), created: time(), updated: time() });
  assert.equal(offset, bytes.length);
  return { cursor, records };
}

test('explicit get-or-create, preserved receivers, owned cursor, enum/date/null projection without arbitrary serialization', async () => {
  let calls = 0;
  const record = memory();
  record.createdAt.getTime = () => { throw new Error('override invoked'); };
  record.createdAt.toJSON = () => { throw new Error('JSON invoked'); };
  Object.defineProperty(record, 'content', { get() { throw new Error('content read'); } });
  Object.defineProperty(record, 'extra', { get() { throw new Error('metadata read'); } });
  const profile = { list(options) { assert.equal(this, profile); assert.deepEqual(options, { limit: 20, cursor: '\ufeffcursor猫\0' }); return { memories: [record], cursor: 'next' }; } };
  const binding = { getProfile(name) { assert.equal(this, binding); assert.equal(name, 'owned-profile'); ++calls; return profile; },
    deleteProfile() { throw new Error('must never delete a profile'); }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
  const input = encoder.encode('\ufeffcursor猫\0'), pending = list(binding, input); input.fill(42);
  const result = await pending;
  assert.equal(result.status, 0);
  record.summary = 'changed';
  assert.deepEqual(decode(result.bytes), { cursor: 'next', records: [{ id: 'memory-猫', type: 0, summary: '\ufeffsummary\0', session: null, created: -1, updated: 1 }] });
  assert.equal(calls, 1);
  const empty = await list(provider(() => ({ memories: [] })));
  assert.deepEqual(decode(empty.bytes), { cursor: null, records: [] });
});

test('SDK caps, all memory types, signed Date endpoints and empty session distinct from null', async () => {
  const max = { id: 'i'.repeat(128), type: 'task', summary: 's'.repeat(4096), sessionId: 'x'.repeat(64),
    createdAt: new Date(-8640000000000000), updatedAt: new Date(8640000000000000) };
  const result = await perform(provider(() => ({ memories: Array.from({ length: 50 }, () => max), cursor: 'c'.repeat(2048) })),
    'p'.repeat(100), encoder.encode('c'.repeat(2048)), '50:60000');
  assert.equal(result.bytes.length, 218260);
  const decoded = decode(result.bytes);
  assert.equal(decoded.records[0].created, -8640000000000000);
  assert.equal(decoded.records[0].updated, 8640000000000000);
  assert.equal(decoded.records[0].type, 3);
  for (const [index, type] of ['fact', 'event', 'instruction', 'task'].entries()) {
    const row = decode((await list(provider(() => ({ memories: [{ ...memory(), type, sessionId: '' }] })))).bytes).records[0];
    assert.equal(row.type, index); assert.equal(row.session, '');
  }
});

test('invalid request/cursor/signal rejected before profile creation', async () => {
  let calls = 0; const binding = { getProfile() { ++calls; } };
  for (const name of ['', 'p'.repeat(101), 'profile\n', 'profile/name', '猫', null])
    await assert.rejects(perform(binding, name, new Uint8Array(), '20:5000'));
  for (const cursor of [null, [], new Uint8Array(2049), new Uint8Array([255])]) await assert.rejects(list(binding, cursor));
  for (const options of ['', '0:1', '51:1', '1:0', '1:60001', '01:1', '1:1\n', '1:1.5']) await assert.rejects(list(binding, undefined, options));
  await assert.rejects(list(binding, undefined, undefined, {}));
  await assert.rejects(list(binding, undefined, undefined, AbortSignal.abort()));
  assert.equal(calls, 0);
  await assert.rejects(list({}), /binding unavailable/);
});

test('malformed pages/records reject instead of truncation, normalization or generic JSON fallback', async () => {
  for (const page of [null, {}, { memories: {} }, { memories: Array(1) }, { memories: Array(21).fill(memory()) },
    { memories: [], cursor: '' }, { memories: [], cursor: null }, { memories: [], cursor: 'c'.repeat(2049) }])
    await assert.rejects(list(provider(() => page)));
  for (const patch of [{ id: '' }, { id: '猫'.repeat(43) }, { type: '__proto__' }, { summary: '\ud800' },
    { summary: 's'.repeat(4097) }, { sessionId: undefined }, { sessionId: 'é'.repeat(33) },
    { createdAt: '1970-01-01' }, { updatedAt: new Date(NaN) }, { createdAt: { getTime: () => 0 } }])
    await assert.rejects(list(provider(() => ({ memories: [{ ...memory(), ...patch }] }))));
});

test('all four roots remain alive during projection and release once in reverse order', async () => {
  const releases = [];
  const own = (value, name) => { value[Symbol.dispose] = () => releases.push(name); return value; };
  const record = memory();
  Object.defineProperty(record, 'summary', { get() { assert.deepEqual(releases, []); return 'owned'; } });
  const page = own({ memories: [record] }, 'page');
  const pending = own(Promise.resolve(page), 'read');
  const profile = own({ list() { return pending; } }, 'profile');
  const acquisition = own(Promise.resolve(profile), 'acquisition');
  await list({ getProfile() { return acquisition; } });
  assert.deepEqual(releases, ['page', 'read', 'profile', 'acquisition']);
});

test('identity aliases release once and borrowed binding aliases are excluded', async () => {
  let releases = 0;
  const scope = { memories: [], list() { return this; }, [Symbol.dispose]() { ++releases; } };
  await list({ getProfile() { return scope; } });
  assert.equal(releases, 1);
  const binding = { getProfile() { return this; }, list() { return { memories: [] }; },
    [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
  await list(binding);
});

test('external listeners removed on success, failure and deadline', async () => {
  for (const page of [() => ({ memories: [] }), () => { throw new Error('failure'); }, () => new Promise(() => {})]) {
    const { signal } = new AbortController(), listeners = new Set();
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options); };
    signal.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener); };
    await list(provider(page), undefined, '1:5', signal).catch(() => {});
    assert.equal(listeners.size, 0);
  }
});

test('late acquisition is disposed without listing or deleting; late result/rejection is observed', async () => {
  let resolve, reads = 0, released = 0;
  await assert.rejects(list({ getProfile() { return new Promise(done => { resolve = done; }); } }, undefined, '1:1'), { name: 'TimeoutError' });
  resolve({ list() { ++reads; }, [Symbol.dispose]() { ++released; } });
  await nextTurn(); assert.equal(reads, 0); assert.equal(released, 1);
  let finish;
  await assert.rejects(list(provider(() => new Promise(done => { finish = done; })), undefined, '1:1'), { name: 'TimeoutError' });
  finish({ memories: [memory()], [Symbol.dispose]() { ++released; } });
  await nextTurn(); assert.equal(released, 2);
  let reject;
  await assert.rejects(list(provider(() => new Promise((_, fail) => { reject = fail; })), undefined, '1:1'), { name: 'TimeoutError' });
  reject(new Error('late rejection')); await nextTurn();
  assert.equal(decode((await list(provider())).bytes).records.length, 1);
});

test('abort in acquisition prevents list, cleanup errors preserve primary failure and reject success', async () => {
  const controller = new AbortController(); let reads = 0, disposed = 0;
  await assert.rejects(list({ getProfile() {
    controller.abort(); return { list() { ++reads; }, [Symbol.dispose]() { ++disposed; } };
  } }, undefined, undefined, controller.signal), { name: 'AbortError' });
  await nextTurn(); assert.equal(reads, 0); assert.equal(disposed, 1);
  for (const bad of [false, true]) {
    await assert.rejects(list(provider(() => ({ memories: bad ? null : [], [Symbol.dispose]() { throw new Error('cleanup failed'); } }))),
      bad ? /invalid Agent Memory page/ : /cleanup failed/);
  }
});
