import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performStreamVideo } from '../lib/stream-video.mjs';
const empty = new Uint8Array();
const list = (binding, options = '10:5000', signal) => performStreamVideo(416, binding, '', empty, options, signal);
const details = (binding, id = 'owned-id', options = '5000', signal) => performStreamVideo(417, binding, id, empty, options, signal);
const info = () => ({ id: 'owned-id', status: { state: 'ready' }, readyToStream: true, size: 448, duration: -1 });
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 4;
  const string = () => { const length = view.getUint32(offset, true); offset += 4;
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + length));
    offset += length; return value; };
  const values = Array.from({ length: view.getUint32(0, true) }, () => {
    const id = string(), state = string(), ready = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true) + view.getUint32(offset + 8, true) * 4294967296;
    const duration = view.getFloat64(offset + 12, true); offset += 20;
    return { id, state, ready, size, duration };
  });
  assert.equal(offset, bytes.length);
  return values;
}

test('list/details preserve receivers and own projections; release returned roots, not binding', async () => {
  const releases = [];
  const value = info();
  Object.defineProperty(value, 'meta', { get() { throw new Error('metadata traversed'); } });
  const result = [value]; result[Symbol.dispose] = () => { releases.push('result'); value.status.state = 'changed'; };
  const scope = { list(options) { assert.equal(this, scope); assert.deepEqual(options, { limit: 10 }); return result; },
    [Symbol.dispose]() { releases.push('scope'); } };
  const acquisition = Promise.resolve(scope); acquisition[Symbol.dispose] = () => releases.push('acquisition');
  const binding = { get videos() { return acquisition; }, [Symbol.dispose]() { throw new Error('borrowed disposed'); } };
  assert.deepEqual(decode((await list(binding)).bytes), [{ id: 'owned-id', state: 'ready', ready: 1, size: 448, duration: -1 }]);
  assert.deepEqual(releases, ['result', 'scope', 'acquisition']);
  const one = info();
  const video = { details() { assert.equal(this, video); return one; } };
  const direct = { video(id) { assert.equal(this, direct); assert.equal(id, 'owned-id'); return video; } };
  assert.equal(decode((await details(direct)).bytes)[0].id, 'owned-id');
});

test('wire bounds and malformed input fail before scope acquisition', async () => {
  let calls = 0;
  const binding = { get videos() { ++calls; }, video() { ++calls; } };
  for (const options of ['0:1', '51:1', '1:0', '1:60001', '01:1', '1:1\n']) await assert.rejects(list(binding, options));
  for (const id of ['', 'x'.repeat(129), 'a/b', '猫', 'id\n']) await assert.rejects(details(binding, id));
  for (const options of ['0', '60001', '01', '1\n']) await assert.rejects(details(binding, undefined, options));
  await assert.rejects(performStreamVideo(416, binding, '', new Uint8Array([1]), '1:1'));
  await assert.rejects(performStreamVideo(418, binding, '', empty, '1:1'));
  await assert.rejects(list(binding, undefined, {}));
  await assert.rejects(list(binding, undefined, AbortSignal.abort()));
  assert.equal(calls, 0);
});

test('projection rejects malformed numbers, text, IDs and result counts without truncation', async () => {
  for (const patch of [{ id: 'wrong/id' }, { status: { state: '' } }, { status: { state: '\ud800' } },
    { status: { state: '猫'.repeat(22) } }, { readyToStream: 1 }, { size: -1 }, { size: 0.5 },
    { size: 9007199254740992 }, { duration: -0.5 }, { duration: NaN }, { duration: Infinity }]) {
    let disposed = 0;
    const result = [{ ...info(), ...patch }]; result[Symbol.dispose] = () => ++disposed;
    await assert.rejects(list({ videos: { list() { return result; } } }));
    assert.equal(disposed, 1);
  }
  for (const value of [null, {}, Array(11).fill(info()), new Array(1)])
    await assert.rejects(list({ videos: { list() { return value; } } }));
  await assert.rejects(details({ video() { return { details() { return { ...info(), id: 'different' }; } }; } }), /ID mismatch/);
});

test('empty and maximum metadata replies preserve safe integers and unknown duration', async () => {
  assert.deepEqual(decode((await list({ videos: { list() { return []; } } })).bytes), []);
  const values = Array.from({ length: 50 }, () => ({ id: 'i'.repeat(128), status: { state: 's'.repeat(64) },
    readyToStream: false, size: Number.MAX_SAFE_INTEGER, duration: 0.125 }));
  const reply = await list({ videos: { list() { return values; } } }, '50:60000');
  assert.equal(reply.bytes.length, 11004);
  assert.equal(decode(reply.bytes)[49].size, Number.MAX_SAFE_INTEGER);
  assert.equal(decode(reply.bytes)[49].duration, 0.125);
});

test('deadline during acquisition disposes a late scope without invoking its read', async () => {
  let resolve, released = 0, reads = 0;
  const pending = new Promise(done => { resolve = done; }); pending[Symbol.dispose] = () => ++released;
  await assert.rejects(list({ videos: pending }, '1:1'), { name: 'TimeoutError' });
  resolve({ list() { ++reads; }, [Symbol.dispose]() { ++released; } });
  await nextTurn();
  assert.equal(released, 2); assert.equal(reads, 0);
});

test('abort during read releases scope/promise and late result once, and observes late failure', async () => {
  const controller = new AbortController();
  let resolve, released = 0;
  const pending = new Promise(done => { resolve = done; }); pending[Symbol.dispose] = () => ++released;
  const scope = { list() { return pending; }, [Symbol.dispose]() { ++released; } };
  const operation = list({ videos: scope }, '1:5000', controller.signal);
  await nextTurn(); controller.abort(new Error('caller ended'));
  await assert.rejects(operation, /caller ended/);
  const late = [info()]; late[Symbol.dispose] = () => ++released;
  resolve(late); await nextTurn(); assert.equal(released, 3);
  let reject;
  await assert.rejects(list({ videos: new Promise((_, fail) => { reject = fail; }) }, '1:1'), { name: 'TimeoutError' });
  reject(new Error('late acquisition')); await nextTurn();
});

test('synchronous acquisition abort and cleanup failure preserve the primary error', async () => {
  const controller = new AbortController(); let reads = 0, releases = 0;
  const binding = { video() {
    controller.abort(new Error('stop'));
    return { details() { ++reads; }, [Symbol.dispose]() { ++releases; throw new Error('cleanup'); } };
  } };
  await assert.rejects(details(binding, undefined, undefined, controller.signal), /stop/);
  await nextTurn(); assert.equal(reads, 0); assert.equal(releases, 1);
  await assert.rejects(list({ videos: { list() { return []; }, [Symbol.dispose]() { throw new Error('cleanup'); } } }), /cleanup/);
});
