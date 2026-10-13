import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBoundedJson, parseBoundedJson } from '../lib/json.mjs';
const roundtrip = value => parseBoundedJson(encodeBoundedJson(value));

test('owned JSON output roundtrips scalars, arrays and ordinary/null-prototype records', () => {
  for (const value of [null, true, false, 1.25, Number.MAX_VALUE, Number.MIN_VALUE, '',
    { text: '☁', nested: [null, false, 42] }, Object.assign(Object.create(null), { key: 'value' })])
    assert.deepEqual(roundtrip(value), JSON.parse(JSON.stringify(value)));
  assert.equal(roundtrip(-0), 0);
  const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
  assert.deepEqual(roundtrip(value), value);
  assert.equal({}.polluted, undefined);
});

test('escaping is bounded and preserves surrogate pairs split between chunks', () => {
  for (const value of ['a'.repeat(1023) + '😀', '\ud800', '\udc00', '\\"\n\t\u0000',
    'a'.repeat(1023) + '\ud800' + '\udc00' + 'z']) assert.equal(roundtrip(value), value);
  const exact = 'a'.repeat(1048574);
  assert.equal(encodeBoundedJson(exact).byteLength, 1048576);
  assert.throws(() => encodeBoundedJson(exact + 'a'), /byte limit/);
  assert.throws(() => encodeBoundedJson('\u0000'.repeat(200000)), /byte limit/);
  assert.throws(() => encodeBoundedJson('☁'.repeat(400000)), /byte limit/);
  assert.throws(() => encodeBoundedJson({ ['a'.repeat(1048576)]: 0 }), /byte limit/);
});

test('deterministic UTF-16 samples survive chunked escaping without lossy replacement', () => {
  let seed = 0x12345678;
  for (let sample = 0; sample < 32; sample++) {
    let text = '';
    for (let i = 0; i < 4097; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += String.fromCharCode(seed & 0xffff);
    }
    assert.equal(roundtrip(text), text);
  }
});

test('node and container-depth bounds include exact limits', () => {
  assert.equal(roundtrip(Array(65535).fill(null)).length, 65535);
  assert.throws(() => encodeBoundedJson(Array(65536).fill(null)), /node limit/);
  let nested = null;
  for (let i = 0; i < 32; i++) nested = [nested];
  assert.deepEqual(roundtrip(nested), nested);
  assert.throws(() => encodeBoundedJson([nested]), /depth/);
});

test('non-JSON values, capabilities, sparse arrays and hidden/extra properties reject', () => {
  class Capability {}
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol(), () => {},
    new Date(), new Map(), new Uint8Array([1]), new Capability(), new Array(1),
    Object.assign([1], { extra: true }), Object.assign([1], { '0\n': true }),
    Object.defineProperty({}, 'hidden', { value: 1 }), { [Symbol('private')]: 1 }])
    assert.throws(() => encodeBoundedJson(value));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => encodeBoundedJson(cycle), /cyclic/);
  const shared = { ok: true };
  assert.deepEqual(roundtrip([shared, shared]), [{ ok: true }, { ok: true }]);
});

test('accessors and toJSON are never invoked', () => {
  let calls = 0;
  for (const value of [Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } }),
    { toJSON() { calls++; return 'wrong'; } },
    Object.defineProperty([], '0', { enumerable: true, get() { calls++; return 1; } })])
    assert.throws(() => encodeBoundedJson(value));
  assert.equal(calls, 0);
  assert.deepEqual(roundtrip({ toJSON: 'ordinary data' }), { toJSON: 'ordinary data' });
});

test('only an explicitly allowed root disposer is ignored; caller still owns disposal', () => {
  let calls = 0;
  const value = { ok: true, [Symbol.dispose]() { calls++; } };
  assert.throws(() => encodeBoundedJson(value), /symbol/);
  assert.deepEqual(parseBoundedJson(encodeBoundedJson(value, { allowRootDisposer: true })), { ok: true });
  assert.equal(calls, 0);
  assert.throws(() => encodeBoundedJson({ child: value }, { allowRootDisposer: true }), /symbol/);
  assert.throws(() => encodeBoundedJson({ [Symbol.dispose]: 1 }, { allowRootDisposer: true }), /symbol/);
  const accessor = Object.defineProperty({}, Symbol.dispose, { get() { calls++; return () => {}; } });
  assert.throws(() => encodeBoundedJson(accessor, { allowRootDisposer: true }), /accessor/);
  assert.throws(() => encodeBoundedJson({}, { allowRootDisposer: 'yes' }), /policy/);
  assert.equal(calls, 0);
});
