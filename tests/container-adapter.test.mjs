import assert from 'node:assert/strict';
import test from 'node:test';
import { performContainerInspect as perform } from '../lib/container.mjs';
const empty = new Uint8Array();
const info = () => ({ image: '', labels: { owner: 'libcf' } });
const run = (value, options = '5000') => perform({ inspect() { return value; } }, '', empty, options);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u32 = () => { const n = view.getUint32(offset, true); offset += 4; return n; };
  const string = () => { const length = u32(), value = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
  let value = null;
  const presence = u32(); assert([0, 1].includes(presence));
  if (presence) { const image = string(), count = u32(), labels = []; for (let i = 0; i < count; ++i) labels.push([string(), string()]); value = { image, labels }; }
  assert.equal(offset, bytes.length);
  return value;
}

test('nullable projection preserves empty image/labels, UTF-8, BOM/NUL image and own special-name labels', async () => {
  assert.equal(decode((await run(null)).bytes), null);
  assert.deepEqual(decode((await run({ image: '', labels: {} })).bytes), { image: '', labels: [] });
  const labels = Object.create(null); labels.__proto__ = ''; labels['猫'] = '\ufeffowned';
  const value = { image: '\ufeffimage\0😀', labels,
    get unrelated() { assert.fail('unrelated traversal'); }, get toJSON() { assert.fail('toJSON'); } };
  const result = await run(value); assert.equal(result.status, 0);
  assert.deepEqual(decode(result.bytes), { image: value.image, labels: [['__proto__', ''], ['猫', '\ufeffowned']] });
  labels['猫'] = 'changed'; value.image = 'changed';
  assert.equal(decode(result.bytes).image, '\ufeffimage\0😀');
  const maximum = { image: 'i'.repeat(2048), labels: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i).padStart(16, 'k'), 'v'.repeat(64)])) };
  assert.equal((await run(maximum)).bytes.length, 2940);
  assert.equal(decode((await run(maximum, '60000')).bytes).labels.length, 10);
});

test('invalid requests/signals fail before borrowed capability access', async () => {
  const binding = { get inspect() { assert.fail('binding touched'); } };
  for (const args of [['x', empty, '1'], ['', [], '1'], ['', new Uint8Array(1), '1'], ['', empty, 1],
    ...['0', '-1', '01', '1\n', '1.5', '60001', '100000', ' 1'].map(options => ['', empty, options])])
    await assert.rejects(perform(binding, ...args), /invalid Container inspection/);
  await assert.rejects(perform(binding, '', empty, '1', {}), /signal/);
  await assert.rejects(perform(binding, '', empty, '1', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, '', empty, '1'), /unavailable/);
});

test('reject malformed values and bounded dictionary fields without coercion', async () => {
  for (const value of [undefined, [], 0, {}, { image: 1, labels: {} }, { image: '\ud800', labels: {} },
    { image: 'i'.repeat(2049), labels: {} }, { image: '猫'.repeat(683), labels: {} },
    ...[null, undefined, [], new Date(), new Map(), Object.create({ x: 'inherited' })].map(labels => ({ image: '', labels })),
    ...['', 'k'.repeat(17), '猫'.repeat(6), '\n', '\u0085', '\ud800'].map(key => ({ image: '', labels: { [key]: '' } })),
    ...[null, 1, 'v'.repeat(65), '猫'.repeat(22), '\0', '\u007f', '\u009f', '\ud800'].map(value => ({ image: '', labels: { k: value } })),
    { image: '', labels: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), ''])) }])
    await assert.rejects(run(value), /invalid Container/);
});

test('receiver preserved; selected fields read once; roots released in reverse; borrowed container untouched', async () => {
  const releases = []; let imageReads = 0, labelReads = 0;
  const value = { get image() { assert.equal(releases.length, 0); ++imageReads; return ''; }, get labels() { assert.equal(releases.length, 0); ++labelReads; return {}; },
    [Symbol.dispose]() { assert.equal(this, value); releases.push('value'); } };
  const pending = Promise.resolve(value); pending[Symbol.dispose] = function() { assert.equal(this, pending); releases.push('pending'); };
  const binding = { inspect(...args) { assert.equal(this, binding); assert.deepEqual(args, []); return pending; },
    get running() { assert.fail('running read'); }, start() { assert.fail('start'); }, destroy() { assert.fail('destroy'); },
    [Symbol.dispose]() { assert.fail('borrowed disposed'); } };
  await perform(binding, '', empty, '5000');
  assert.deepEqual(releases, ['value', 'pending']); assert.equal(imageReads, 1); assert.equal(labelReads, 1);
  binding.image = ''; binding.labels = {}; binding.inspect = () => binding;
  await perform(binding, '', empty, '5000');
});

test('cleanup failure rejects success, preserves primary failure and deduplicates aliases', async () => {
  await assert.rejects(run({ ...info(), [Symbol.dispose]() { throw new Error('cleanup'); } }), /cleanup/);
  await assert.rejects(run({ image: 1, [Symbol.dispose]() { throw new Error('cleanup'); } }), /invalid Container/);
  await assert.rejects(run({ ...info(), [Symbol.dispose]: 1 }), /invalid Container inspection disposer/);
  let releases = 0;
  const alias = { ...info(), then(resolve) { delete this.then; resolve(this); }, [Symbol.dispose]() { ++releases; } };
  await run(alias); assert.equal(releases, 1);
});

test('deadlines/abort dispose late results once and observe late rejection', async () => {
  for (const mode of ['deadline', 'abort', 'reject']) {
    let resolve, reject, pendingReleases = 0, valueReleases = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending[Symbol.dispose] = () => { ++pendingReleases; };
    const controller = new AbortController();
    const outcome = perform({ inspect: () => pending }, '', empty, mode === 'deadline' ? '5' : '5000', controller.signal);
    const rejected = assert.rejects(outcome, { name: mode === 'deadline' ? 'TimeoutError' : 'AbortError' });
    await tick();
    if (mode !== 'deadline') controller.abort();
    await rejected;
    if (mode === 'reject') reject(new Error('late rejection'));
    else resolve({ ...info(), [Symbol.dispose]() { ++valueReleases; throw new Error('late cleanup'); } });
    await tick();
    assert.equal(pendingReleases, 1); assert.equal(valueReleases, mode === 'reject' ? 0 : 1);
  }
});

test('synchronous abort during invocation releases returned root and removes caller listener', async () => {
  const controller = new AbortController(); let added = 0, removed = 0, released = 0;
  const signal = controller.signal, add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { ++added; return add(...args); };
  signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
  await assert.rejects(perform({ inspect() { controller.abort(); return { ...info(), [Symbol.dispose]() { ++released; } }; } }, '', empty, '5000', signal), { name: 'AbortError' });
  assert.equal(released, 1); assert.equal(added, 1); assert.equal(removed, 1);
});
