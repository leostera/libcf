import assert from 'node:assert/strict';
import test from 'node:test';
import { performVectorize } from '../lib/vectorize.mjs';

function floats(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return bytes;
}
const query = (binding, body = floats([1, 0, -0.5]), options = '5:5000', signal) =>
  performVectorize(binding, '', body, options, signal);
const empty = { count: 0, matches: [] };

test('copies float32 input, preserves receiver, encodes owned Unicode IDs and binary64 scores', async () => {
  const body = floats([1, 0, -0.5]);
  const binding = { async query(vector, options) {
    assert.equal(this, binding);
    assert.deepEqual(vector, [1, 0, -0.5]);
    assert.deepEqual(options, { topK: 5, returnValues: false, returnMetadata: 'none' });
    return { count: 2, matches: [{ id: '猫', score: -0.25 }, { id: 'second', score: 12345.125 }] };
  } };
  const pending = query(binding, body);
  body.fill(0);
  const { status, bytes } = await pending;
  assert.equal(status, 0);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 2);
  assert.equal(view.getUint32(4, true), 3);
  assert.equal(new TextDecoder().decode(bytes.subarray(8, 11)), '猫');
  assert.equal(view.getFloat64(11, true), -0.25);
  assert.equal(view.getFloat64(29, true), 12345.125);
});

test('invalid dimensions/options do not invoke the provider; max dimensions and topK are supported', async () => {
  let calls = 0;
  const binding = { query() { calls++; return empty; } };
  for (const body of [new Uint8Array(), new Uint8Array(3), floats([NaN]), floats([Infinity]), floats(Array(1537).fill(1))])
    await assert.rejects(query(binding, body));
  for (const options of ['', '0:5', '101:5', '01:5', '5:0', '5:60001', '5:5000\n'])
    await assert.rejects(query(binding, floats([1]), options));
  await assert.rejects(performVectorize(binding, 'unexpected', floats([1]), '5:5000'));
  await assert.rejects(query(binding, floats([1]), '5:5000', {}));
  assert.equal(calls, 0);
  assert.deepEqual((await query(binding, floats(Array(1536).fill(1)), '100:60000')).bytes, new Uint8Array(4));
  assert.equal(calls, 1);
  const padded = new Uint8Array(12);
  padded.set(floats([0.25]), 4);
  await query({ query(vector) { assert.deepEqual(vector, [0.25]); return empty; } }, padded.subarray(4, 8));
});

test('malformed or over-limit provider records fail instead of coercing values', async () => {
  const bad = [null, {}, { count: 1, matches: [] }, { count: 0, matches: {} },
    { count: 6, matches: Array(6).fill({ id: 'x', score: 1 }) }];
  for (const match of [null, { id: '', score: 0 }, { id: 'x'.repeat(65), score: 0 },
    { id: '猫'.repeat(22), score: 0 }, { id: '\ud800', score: 0 },
    { id: 'x', score: NaN }, { id: 'x', score: Infinity }, { id: 'x', score: '1' }])
    bad.push({ count: 1, matches: [match] });
  for (const result of bad) await assert.rejects(query({ query: () => result }));
  const matches = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`.padEnd(64, 'x'), score: i }));
  assert.equal((await query({ query: () => ({ count: 100, matches }) }, floats([1]), '100:5000')).bytes.byteLength, 7604);
});

test('deadline, pre/synchronous/late abort and provider errors never retry; late results are not encoded', async () => {
  let calls = 0, finish;
  const pending = { query() { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(query(pending, undefined, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(query(pending, floats([1]), '5:10'), { name: 'TimeoutError' });
  assert.equal(calls, 1);
  let inspected = false;
  finish({ get matches() { inspected = true; throw new Error('late result inspected'); } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(inspected, false);
  const later = new AbortController();
  const operation = query(pending, undefined, undefined, later.signal);
  await Promise.resolve();
  later.abort();
  await assert.rejects(operation, { name: 'AbortError' });
  finish(empty);
  const synchronous = new AbortController();
  await assert.rejects(query({ query() { synchronous.abort(); return empty; } }, undefined, undefined, synchronous.signal), { name: 'AbortError' });
  for (const invoke of [() => { throw new Error('sync'); }, () => Promise.reject(new Error('async'))])
    await assert.rejects(query({ query: invoke }));
  let failLate;
  await assert.rejects(query({ query() { return new Promise((_, reject) => { failLate = reject; }); } }, floats([1]), '1:10'), { name: 'TimeoutError' });
  failLate(new Error('late provider rejection'));
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(query({}));
  assert.deepEqual((await query({ query: () => empty })).bytes, new Uint8Array(4));
});
