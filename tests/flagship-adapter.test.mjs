import assert from 'node:assert/strict';
import test from 'node:test';
import { performFlagshipBooleanDetails as perform } from '../lib/flagship.mjs';
const empty = new Uint8Array();
const details = () => ({ flagKey: 'flag', value: false, reason: 'STATIC', variant: 'off' });
const run = (value, options = '1:5000') => perform({ getBooleanDetails() { return value; } }, 'flag', empty, options);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u32 = () => { const n = view.getUint32(offset, true); offset += 4; return n; };
  const boolean = u32(); assert([0, 1].includes(boolean));
  const result = { value: boolean === 1 };
  for (const name of ['variant', 'reason', 'errorCode', 'errorMessage']) {
    const present = u32(); assert([0, 1].includes(present));
    if (present) {
      const size = u32();
      result[name] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + size));
      offset += size;
    }
  }
  assert.equal(offset, bytes.length);
  return result;
}

test('preserve evaluated false, fallback details, optional/empty fields, future reasons and opaque UTF-8', async () => {
  assert.deepEqual(decode((await run(details())).bytes), { value: false, variant: 'off', reason: 'STATIC' });
  const value = { flagKey: 'flag', value: true, variant: '', reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND', errorMessage: '\ufeff猫\0😀' };
  assert.deepEqual(decode((await run(value)).bytes), { value: true, variant: '', reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND', errorMessage: value.errorMessage });
  assert.deepEqual(decode((await run({ flagKey: 'flag', value: true, reason: 'FUTURE' })).bytes), { value: true, reason: 'FUTURE' });
  assert.equal((await run({ flagKey: 'flag', value: false })).bytes.length, 20);
  const maximum = { flagKey: 'flag', value: true, variant: 'v'.repeat(256), reason: 'r'.repeat(64), errorCode: 'c'.repeat(64), errorMessage: 'm'.repeat(4096) };
  const result = await run(maximum, '0:60000'); assert.equal(result.status, 0); assert.equal(result.bytes.length, 4516);
  maximum.errorMessage = 'changed'; assert.equal(decode(result.bytes).errorMessage.length, 4096);
});

test('validate all input before binding access, without coercion', async () => {
  const binding = { get getBooleanDetails() { assert.fail('binding accessed'); } };
  for (const key of ['', 1, 'k'.repeat(129), '猫'.repeat(43), '\0', '\u0085', '\ud800'])
    await assert.rejects(perform(binding, key, empty, '0:1'), /invalid Flagship/);
  for (const body of [[], new Uint8Array(257), new Uint8Array([255]), new Uint8Array([0]), new TextEncoder().encode('\u0085')])
    await assert.rejects(perform(binding, 'flag', body, '0:1'));
  for (const options of [1, '0', 'true:1', '2:1', '1:0', '1:01', '1:1\n', '1:1.5', '1:60001', '1:100000', ' 1:1'])
    await assert.rejects(perform(binding, 'flag', empty, options), /invalid Flagship/);
  await assert.rejects(perform(binding, 'flag', empty, '0:1', {}), /signal/);
  await assert.rejects(perform(binding, 'flag', empty, '0:1', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, 'flag', empty, '0:1'), /unavailable/);
});

test('snapshot bounded targetingKey before async return and preserve receiver and argument shape', async () => {
  const key = '猫'.repeat(42) + 'ab', target = '\ufeff' + 't'.repeat(253);
  const body = new TextEncoder().encode(target);
  const binding = { getBooleanDetails(...args) { assert.equal(this, binding); assert.deepEqual(args, [key, false, { targetingKey: target }]); return { flagKey: key, value: true }; } };
  const pending = perform(binding, key, body, '0:5000'); body.fill(0);
  assert.equal(decode((await pending).bytes).value, true);
  await perform({ getBooleanDetails(...args) { assert.deepEqual(args, ['flag', true]); return details(); } }, 'flag', empty, '1:5000');
});

test('reject malformed provider data instead of inventing fallbacks', async () => {
  for (const value of [null, undefined, [], {}, { flagKey: 'other', value: true }, { flagKey: 'flag', value: 1 },
    ...['variant', 'reason', 'errorCode', 'errorMessage'].flatMap(field => [null, 1, '\ud800'].map(value => ({ ...details(), [field]: value }))),
    ...[['variant', 256], ['reason', 64], ['errorCode', 64], ['errorMessage', 4096]].flatMap(([field, cap]) =>
      ['x'.repeat(cap + 1), '猫'.repeat(Math.floor(cap / 3) + 1)].map(value => ({ ...details(), [field]: value })))])
    await assert.rejects(run(value), /invalid Flagship/);
  const primary = new Error('transport');
  await assert.rejects(perform({ getBooleanDetails() { throw primary; } }, 'flag', empty, '1:5000'), error => error === primary);
  const rejected = Promise.reject(primary);
  rejected[Symbol.dispose] = () => { throw new Error('cleanup after rejection'); };
  await assert.rejects(run(rejected), error => error === primary);
  let released = false;
  await assert.rejects(run({ ...details(), get reason() { throw primary; }, [Symbol.dispose]() { released = true; } }), error => error === primary);
  assert.equal(released, true);
});

test('read selected fields once, avoid unrelated traversal, release roots in reverse and exclude borrowed binding', async () => {
  const releases = [], reads = [];
  const source = { ...details(), errorCode: undefined, errorMessage: '' };
  const result = { get unrelated() { assert.fail('unrelated'); }, get toJSON() { assert.fail('toJSON'); },
    [Symbol.dispose]() { assert.equal(this, result); releases.push('result'); } };
  for (const key of Object.keys(source)) Object.defineProperty(result, key, { get() { assert.equal(releases.length, 0); reads.push(key); return source[key]; } });
  const pending = Promise.resolve(result); pending[Symbol.dispose] = function() { assert.equal(this, pending); releases.push('pending'); };
  const binding = { getBooleanDetails() { assert.equal(this, binding); return pending; }, [Symbol.dispose]() { assert.fail('borrowed'); } };
  await perform(binding, 'flag', empty, '1:5000');
  assert.deepEqual(reads, ['flagKey', 'value', 'variant', 'reason', 'errorCode', 'errorMessage']); assert.deepEqual(releases, ['result', 'pending']);
  Object.assign(binding, details()); binding.getBooleanDetails = () => binding;
  await perform(binding, 'flag', empty, '1:5000');
});

test('cleanup failure rejects success, preserves primary error and deduplicates aliases', async () => {
  await assert.rejects(run({ ...details(), [Symbol.dispose]() { throw new Error('cleanup'); } }), /cleanup/);
  await assert.rejects(run({ ...details(), value: null, [Symbol.dispose]() { throw new Error('cleanup'); } }), /invalid Flagship/);
  await assert.rejects(run({ ...details(), [Symbol.dispose]: 1 }), /disposer/);
  let count = 0;
  const alias = { ...details(), then(resolve) { delete this.then; resolve(this); }, [Symbol.dispose]() { ++count; } };
  await run(alias); assert.equal(count, 1);
});

test('deadline/abort drains late results and rejections without disposing borrowed binding', async () => {
  for (const mode of ['deadline', 'abort', 'reject']) {
    let resolve, reject, pendingReleases = 0, resultReleases = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending[Symbol.dispose] = () => { ++pendingReleases; };
    const controller = new AbortController();
    const binding = { getBooleanDetails: () => pending, [Symbol.dispose]() { assert.fail('borrowed'); } };
    const outcome = perform(binding, 'flag', empty, mode === 'deadline' ? '1:5' : '1:5000', controller.signal);
    const rejected = assert.rejects(outcome, { name: mode === 'deadline' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode !== 'deadline') controller.abort(); await rejected;
    if (mode === 'reject') reject(new Error('late rejection'));
    else resolve({ ...details(), [Symbol.dispose]() { ++resultReleases; throw new Error('late cleanup'); } });
    await tick(); assert.equal(pendingReleases, 1); assert.equal(resultReleases, mode === 'reject' ? 0 : 1);
  }
});

test('synchronous abort during invocation releases returned root and removes caller listener', async () => {
  const controller = new AbortController(); let added = 0, removed = 0, released = 0;
  const signal = controller.signal, add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { ++added; return add(...args); };
  signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
  await assert.rejects(perform({ getBooleanDetails() { controller.abort(); return { ...details(), [Symbol.dispose]() { ++released; } }; } }, 'flag', empty, '0:5000', signal), { name: 'AbortError' });
  assert.equal(released, 1); assert.equal(added, 1); assert.equal(removed, 1);
});
