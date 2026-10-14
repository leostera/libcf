import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performAiSearch } from '../lib/ai-search.mjs';
const encoder = new TextEncoder();
const query = (binding, body = encoder.encode('query'), options = '5:5000', signal) =>
  performAiSearch(binding, '', body, options, signal);
const chunk = () => ({ id: '\ufeffchunk-猫', type: 'text', score: 0.75, text: 'owned\u0000text', item: { key: 'doc/猫.txt' } });
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 4;
  const string = () => { const length = view.getUint32(offset, true); offset += 4;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + length));
    offset += length; return text; };
  const matches = Array.from({ length: view.getUint32(0, true) }, () => {
    const id = string(), score = view.getFloat64(offset, true); offset += 8;
    return { id, score, key: string(), text: string() };
  });
  assert.equal(offset, bytes.length);
  return matches;
}

test('keyword-only options, receiver and owned query/result projection; metadata is never traversed', async () => {
  let disposed = 0;
  const binding = { search(request) {
    assert.equal(this, binding);
    assert.deepEqual(request, { query: '\ufeff猫', ai_search_options: {
      retrieval: { retrieval_type: 'keyword', keyword_match_mode: 'and', match_threshold: 0,
        max_num_results: 5, context_expansion: 0, metadata_only: false, return_on_failure: false },
      query_rewrite: { enabled: false }, reranking: { enabled: false }, cache: { enabled: false },
    } });
    const value = chunk();
    Object.defineProperty(value.item, 'metadata', { get() { throw new Error('metadata inspected'); } });
    let scoreReads = 0;
    Object.defineProperty(value, 'score', { get() { return ++scoreReads === 1 ? 0.75 : NaN; } });
    return { chunks: [value], [Symbol.dispose]() { ++disposed; value.text = 'mutated during disposal'; } };
  } };
  const input = encoder.encode('\ufeff猫');
  const pending = query(binding, input);
  input.fill(0);
  const result = await pending;
  assert.equal(result.status, 0);
  assert.deepEqual(decode(result.bytes), [{ id: '\ufeffchunk-猫', score: 0.75, key: 'doc/猫.txt', text: 'owned\u0000text' }]);
  assert.equal(disposed, 1); // A synchronous result is both pending and value.
});

test('invalid input is rejected before provider calls', async () => {
  let calls = 0;
  const binding = { search() { ++calls; } };
  for (const body of [null, [], new Uint8Array(), new Uint8Array(4097), new Uint8Array([255])])
    await assert.rejects(query(binding, body));
  for (const options of ['', '0:1', '51:1', '1:0', '1:60001', '01:1', '1:1\n', '1:-1', '1:1.5'])
    await assert.rejects(query(binding, undefined, options));
  await assert.rejects(performAiSearch(binding, 'namespace', encoder.encode('x'), '1:1'));
  await assert.rejects(query(binding, undefined, undefined, {}));
  await assert.rejects(query(binding, undefined, undefined, AbortSignal.abort(new Error('stopped'))), /stopped/);
  assert.equal(calls, 0);
});

test('malformed results fail, with owned root disposal even when projection rejects', async () => {
  const invalid = [null, { chunks: {} }, { chunks: Array(6).fill(chunk()) }];
  for (const patch of [{ type: 'image' }, { score: NaN }, { score: -1 }, { score: 1.1 },
    { id: '' }, { id: '猫'.repeat(86) }, { id: '\ud800' }, { text: 'x'.repeat(16385) },
    { item: { key: '' } }, { item: { key: 'x'.repeat(2049) } }]) invalid.push({ chunks: [{ ...chunk(), ...patch }] });
  for (const value of invalid) {
    let disposed = 0;
    if (value) value[Symbol.dispose] = () => { ++disposed; };
    await assert.rejects(query({ search() { return value; } }));
    assert.equal(disposed, value ? 1 : 0);
  }
  const sparse = new Array(1);
  await assert.rejects(query({ search() { return { chunks: sparse }; } }));
});

test('empty and maximum projected replies fit the exact wire budget', async () => {
  assert.deepEqual(decode((await query({ search() { return { chunks: [] }; } })).bytes), []);
  const chunks = Array.from({ length: 50 }, () => ({ id: 'i'.repeat(256), type: 'text', score: 1,
    item: { key: 'k'.repeat(2048) }, text: 't'.repeat(16384) }));
  const result = await query({ search() { return { chunks }; } }, encoder.encode('x'.repeat(4096)), '50:60000');
  assert.equal(result.bytes.length, 935404);
  assert.equal(decode(result.bytes).length, 50);
});

test('deadline disposes pending once and drains a late owned result; late rejection is observed', async () => {
  let resolve, pendingDisposals = 0, resultDisposals = 0;
  const pending = new Promise(done => { resolve = done; });
  pending[Symbol.dispose] = () => { ++pendingDisposals; };
  await assert.rejects(query({ search() { return pending; } }, undefined, '1:1'), { name: 'TimeoutError' });
  resolve({ chunks: [chunk()], [Symbol.dispose]() { ++resultDisposals; } });
  await nextTurn();
  assert.equal(pendingDisposals, 1); assert.equal(resultDisposals, 1);
  let reject;
  await assert.rejects(query({ search() { return new Promise((_, fail) => { reject = fail; }); } }, undefined, '1:1'), { name: 'TimeoutError' });
  reject(new Error('late')); await nextTurn();
  assert.deepEqual(decode((await query({ search() { return { chunks: [] }; } })).bytes), []);
});

test('synchronous abort, cleanup failures and borrowed binding ownership', async () => {
  const controller = new AbortController();
  let disposals = 0;
  const binding = { search() {
    controller.abort(new Error('abort wins'));
    return { chunks: [], [Symbol.dispose]() { ++disposals; throw new Error('cleanup failed'); } };
  }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
  await assert.rejects(query(binding, undefined, undefined, controller.signal), /abort wins/);
  await nextTurn(); assert.equal(disposals, 1);
  await assert.rejects(query({ search() { return { chunks: [], [Symbol.dispose]() { throw new Error('cleanup failed'); } }; } }), /cleanup failed/);
  const borrowed = { chunks: [], search() { return this; }, [Symbol.dispose]() { throw new Error('must not dispose'); } };
  assert.deepEqual(decode((await query(borrowed)).bytes), []);
});
