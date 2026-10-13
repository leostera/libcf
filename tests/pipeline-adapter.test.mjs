import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePipelineBatch, performPipeline } from '../lib/pipeline.mjs';
const bytes = text => new TextEncoder().encode(text);

test('JSON batch parser retains nested values and treats prototype keys as data', () => {
  const records = parsePipelineBatch(bytes('[{"__proto__":{"x":1},"values":[null,true,false,1.25,"☁\\n\\\""],"quoted":"[[[[{{{{"}]'));
  assert(Object.hasOwn(records[0], '__proto__'));
  assert.equal(Object.getPrototypeOf(records[0]), Object.prototype);
  assert.equal({}.x, undefined);
  assert.deepEqual(records[0].values, [null, true, false, 1.25, '☁\n"']);
  assert.equal(parsePipelineBatch(bytes(JSON.stringify(Array.from({ length: 1000 }, () => ({}))))).length, 1000);
});

test('exact byte, depth and node bounds remain accepted', () => {
  assert.deepEqual(parsePipelineBatch(bytes('[{}]' + ' '.repeat(1048572))), [{}]);
  assert.equal(parsePipelineBatch(bytes('[{"x":' + '['.repeat(30) + '0' + ']'.repeat(30) + '}]')).length, 1);
  assert.equal(parsePipelineBatch(bytes(JSON.stringify([{ many: Array(65533).fill(null) }])))[0].many.length, 65533);
});

test('invalid batches fail before provider invocation', async () => {
  let calls = 0;
  const binding = { async send() { calls++; } };
  const invalid = ['', '{}', '[]', '[null]', '[[1]]', '[true]', '[{"x":1e400}]',
    JSON.stringify(Array.from({ length: 1001 }, () => ({}))),
    '[{"x":' + '['.repeat(31) + '0' + ']'.repeat(31) + '}]',
    JSON.stringify([{ many: Array(65536).fill(null) }])];
  for (const input of invalid) await assert.rejects(performPipeline(binding, bytes(input)));
  await assert.rejects(performPipeline(binding, new Uint8Array([255])));
  await assert.rejects(performPipeline(binding, new Uint8Array(1048577)));
  assert.equal(calls, 0);
});

test('send completion is awaited and provider rejection is not swallowed', async () => {
  let resolve;
  let completed = false;
  const pending = performPipeline({ send(records) {
    assert.deepEqual(records, [{ value: 'fixture' }]);
    return new Promise(done => { resolve = done; });
  } }, bytes('[{"value":"fixture"}]')).then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  resolve();
  assert.deepEqual(await pending, { status: 0, bytes: new Uint8Array() });
  await assert.rejects(performPipeline({ async send() { throw new Error('provider failure'); } }, bytes('[{}]')), /provider failure/);
});
