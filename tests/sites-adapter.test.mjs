import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSitesManifest, performSitesGet as perform } from '../lib/sites.mjs';
const empty = new Uint8Array(), limit = 1048576;
const manifest = parseSitesManifest('{"index.html":"index.hash.html","empty":"empty.hash","missing":"missing.hash"}');
const bytes = value => new ReadableStream({ start(controller) { controller.enqueue(value); controller.close(); } });
const run = value => perform({ get: () => value }, manifest, 'index.html', empty, '5000');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('manifest is an opaque owned mapping, with own-key semantics and no raw fallback', async () => {
  const token = parseSitesManifest('{"__proto__":"proto.hash","constructor":"constructor.hash","space 猫.bin":"$__MINIFLARE_SITES__$/space%20%E7%8C%AB.bin"}');
  assert(Object.isFrozen(token)); assert.deepEqual(Object.keys(token), []);
  const requested = [];
  const binding = { get(...args) { assert.equal(this, binding); requested.push(args); return bytes(new Uint8Array([0, 255, 128])); }, [Symbol.dispose]() { assert.fail('borrowed'); } };
  for (const key of ['__proto__', 'constructor', 'space 猫.bin']) {
    const result = await perform(binding, token, key, empty, '60000'); assert.equal(result.status, 0); assert.deepEqual(result.bytes, new Uint8Array([0, 255, 128]));
  }
  assert.deepEqual(requested, [['proto.hash', 'stream'], ['constructor.hash', 'stream'], ['$__MINIFLARE_SITES__$/space%20%E7%8C%AB.bin', 'stream']]);
  const missing = await perform({ get get() { assert.fail('namespace touched on manifest miss'); } }, token, 'toString', empty, '5000');
  assert.deepEqual(missing, { status: 1, bytes: empty });
  assert.deepEqual(await run(null), { status: 1, bytes: empty });
  assert.deepEqual(await run(bytes(empty)), { status: 0, bytes: empty });
  await assert.rejects(perform(binding, {}, 'index.html', empty, '5000'), /manifest token/);
});

test('manifest and path caps, exact local mapping, prototype fields and JSON scalar shapes', () => {
  const json = '{"a":"b"}'; assert(parseSitesManifest(json + ' '.repeat(limit - json.length)));
  assert.throws(() => parseSitesManifest(json + ' '.repeat(limit - json.length + 1)));
  assert(parseSitesManifest(JSON.stringify(Object.fromEntries(Array.from({ length: 1024 }, (_, i) => ['k' + i, 'v' + i])))));
  assert.throws(() => parseSitesManifest(JSON.stringify(Object.fromEntries(Array.from({ length: 1025 }, (_, i) => ['k' + i, 'v' + i])))), /entry limit/);
  assert(parseSitesManifest(JSON.stringify({ ['k'.repeat(512)]: 'v'.repeat(512) })));
  assert(parseSitesManifest('{}'));
  const unicode = '猫'.repeat(170) + 'ab'; // Exactly512 UTF-8 bytes, not512 JS code units.
  assert(parseSitesManifest(JSON.stringify({ [unicode]: unicode })));
  assert.throws(() => parseSitesManifest(JSON.stringify({ [unicode + 'x']: 'h' })));
  assert.throws(() => parseSitesManifest(JSON.stringify({ key: unicode + 'x' })));
  for (const json of ['', 'null', '[]', '1', 'true', '"text"', '{', '{"a":null}', '{"a":1}', '{"a":{}}', '{"a":[]}']) assert.throws(() => parseSitesManifest(json));
  for (const bad of ['', '/', '/a', 'a/', 'a//b', '.', '..', 'a/../b', 'a/./b', 'a\\b', 'a:b', 'a?b', 'a#b', '%2e', 'a\0b', '\ud800', '\ufeffa', 'a\u0085b', ' a', 'a ', 'a/ b', 'x'.repeat(513)]) {
    assert.throws(() => parseSitesManifest(JSON.stringify({ [bad]: 'value' })));
    assert.throws(() => parseSitesManifest(JSON.stringify({ key: bad })));
  }
  for (const mapping of ['$__MINIFLARE_SITES__$/other', '$__MINIFLARE_SITES__$/a%252Fb', '$__MINIFLARE_SITES__$/a/b']) assert.throws(() => parseSitesManifest(JSON.stringify({ 'a/b': mapping })), /local mapping/);
  assert(parseSitesManifest('{"a/b":"$__MINIFLARE_SITES__$/a%2Fb"}'));
  assert.throws(() => parseSitesManifest({ toString() { assert.fail('coercion'); } }));
});

test('input validation precedes lookup; no undefined-as-missing or arbitrary stream coercion', async () => {
  const binding = { get get() { assert.fail('binding accessed'); } };
  for (const key of ['', '../x', 'a%20b', 'a\n', 'x'.repeat(513)]) await assert.rejects(perform(binding, manifest, key, empty, '5000'));
  for (const options of [1, '', '0', '01', '1\n', '60001']) await assert.rejects(perform(binding, manifest, 'index.html', empty, options));
  for (const body of [[], new Uint8Array(1)]) await assert.rejects(perform(binding, manifest, 'index.html', body, '5000'));
  await assert.rejects(perform(binding, manifest, 'index.html', empty, '5000', {}), /signal/);
  await assert.rejects(perform(binding, manifest, 'index.html', empty, '5000', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, manifest, 'index.html', empty, '5000'), /unavailable/);
  for (const value of [undefined, '', new ArrayBuffer(0), new Uint8Array(1), { getReader() { assert.fail('duck stream'); } }]) await assert.rejects(run(value), /Sites read stream/);
});

test('streamed byte cap inclusive, owned reused chunks, root lifetime and cleanup error semantics', async () => {
  const released = [], scratch = new Uint8Array([1, 2]); let reads = 0;
  const stream = new ReadableStream({ pull(controller) {
    assert.equal(released.length, 0);
    if (++reads === 1) controller.enqueue(scratch);
    else if (reads === 2) { scratch.set([3, 4]); controller.enqueue(scratch); }
    else controller.close();
  } }, { highWaterMark: 0 });
  stream[Symbol.dispose] = () => { released.push('stream'); scratch.fill(0); };
  const pending = Promise.resolve(stream); pending[Symbol.dispose] = () => released.push('pending');
  assert.deepEqual((await run(pending)).bytes, new Uint8Array([1, 2, 3, 4])); assert.deepEqual(released, ['stream', 'pending']);
  assert.equal((await run(bytes(new Uint8Array(limit)))).bytes.length, limit);
  let canceled = 0;
  const oversized = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(limit + 1)); }, cancel() { ++canceled; return new Promise(() => {}); } });
  await assert.rejects(run(oversized), /body exceeds limit/); assert.equal(canceled, 1);
  await assert.rejects(run(bytes('not bytes')), /chunk must be Uint8Array/);
  const badCleanup = bytes(empty); badCleanup[Symbol.dispose] = () => { throw new Error('cleanup'); };
  await assert.rejects(run(badCleanup), /cleanup/);
  const primary = new Error('primary'), failed = new ReadableStream({ start(c) { c.error(primary); } });
  failed[Symbol.dispose] = () => { throw new Error('secondary'); }; await assert.rejects(run(failed), error => error === primary);
  const invalid = { [Symbol.dispose]() { ++canceled; } }; await assert.rejects(run(invalid), /Sites read stream/); assert.equal(canceled, 2);
});

test('late lookup streams cancel without consumption, active read cancels and late rejections drain', async () => {
  for (const stage of ['lookup', 'read']) for (const mode of ['abort', 'timeout']) {
    let resolve, canceled = 0, pulled = 0;
    const stream = new ReadableStream({ pull() { ++pulled; return new Promise(() => {}); }, cancel() { ++canceled; } }, { highWaterMark: 0 });
    const pending = new Promise(yes => { resolve = yes; });
    const controller = new AbortController();
    const result = perform({ get: () => stage === 'lookup' ? pending : stream }, manifest, 'index.html', empty, mode === 'timeout' ? '5' : '5000', controller.signal);
    const rejected = assert.rejects(result, { name: mode === 'timeout' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode === 'abort') controller.abort(); await rejected;
    resolve(stream); await tick(); assert.equal(canceled, 1); assert.equal(pulled, stage === 'lookup' ? 0 : 1);
  }
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  await assert.rejects(perform({ get: () => pending }, manifest, 'index.html', empty, '5'), { name: 'TimeoutError' });
  reject(new Error('late lookup rejection')); await tick();
  let calls = 0; const primary = new Error('lookup failed');
  await assert.rejects(perform({ get() { ++calls; throw primary; } }, manifest, 'index.html', empty, '5000'), error => error === primary); assert.equal(calls, 1);
  const controller = new AbortController(); let canceled = 0, disposed = 0, removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
  const stream = new ReadableStream({ cancel() { ++canceled; throw new Error('cancel failed'); } }, { highWaterMark: 0 });
  stream[Symbol.dispose] = () => { ++disposed; throw new Error('dispose failed'); };
  await assert.rejects(perform({ get() { controller.abort(); return stream; } }, manifest, 'index.html', empty, '5000', controller.signal), { name: 'AbortError' });
  await tick(); assert.equal(canceled, 1); assert.equal(disposed, 1); assert.equal(removed, 1);
});
