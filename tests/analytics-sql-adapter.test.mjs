import assert from 'node:assert/strict';
import test from 'node:test';
import { performAnalyticsSql as perform } from '../lib/analytics-sql.mjs';
const empty = new Uint8Array(), encoder = new TextEncoder();
const query = 'SELECT value FROM owned WHERE timestamp >= $start LIMIT 10';
const result = (data = []) => ({ data, rows: data.length, statistics: { elapsed_ms: 0.25, rows_read: 10, bytes_read: 100 } });
const run = (value, options = '100:5000') => perform({ query: () => value }, query, empty, options);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0;
  const u32 = () => { const n = view.getUint32(offset, true); offset += 4; return n; };
  const f64 = () => { const n = view.getFloat64(offset, true); offset += 8; return n; };
  const u64 = () => { const n = view.getBigUint64(offset, true); offset += 8; return Number(n); };
  const string = () => { const n = u32(), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + n)); offset += n; return text; };
  const count = u32(), statistics = { elapsed_ms: f64(), rows_read: u64(), bytes_read: u64() }, rows = [];
  for (let i = 0; i < count; ++i) {
    const columns = [], count = u32();
    for (let j = 0; j < count; ++j) {
      const name = string(), kind = u32(); assert(kind <= 4);
      columns.push([name, kind === 0 ? null : kind === 1 ? false : kind === 2 ? true : kind === 3 ? f64() : string()]);
    }
    rows.push(columns);
  }
  assert.equal(offset, bytes.length); return { rows, statistics };
}

test('owned scalar rows and statistics preserve null/bool/number/text and special names without serialization', async () => {
  const row = JSON.parse('{"__proto__":null,"constructor":false,"yes":true}');
  row.number = -0; row.fraction = 0.25; row.text = '\ufeff猫\0😀'; row.empty = '';
  const value = { ...result([row, {}]), get unrelated() { assert.fail('unrelated'); }, get toJSON() { assert.fail('toJSON'); } };
  const reply = await run(value); assert.equal(reply.status, 0);
  row.text = 'changed';
  assert.deepEqual(decode(reply.bytes), { rows: [[['__proto__', null], ['constructor', false], ['yes', true], ['number', -0], ['fraction', 0.25], ['text', '\ufeff猫\0😀'], ['empty', '']], []], statistics: result().statistics });
  assert.equal((await run(result())).bytes.length, 28);
  assert.equal(decode((await run(result(Array.from({ length: 100 }, () => ({}))))).bytes).rows.length, 100);
});

test('parameter kinds and absence/empty shapes preserved, parsed before asynchronous return', async () => {
  for (const params of [undefined, [], {}, [null, false, true, -2.5, '\ufeff猫\0'], JSON.parse('{"__proto__":"owned","constructor":null,"start":1}')]) {
    const bytes = params === undefined ? empty : encoder.encode(JSON.stringify(params));
    const binding = { query(...args) {
      assert.equal(this, binding); assert.equal(args.length, 1); assert.equal(args[0].query, query);
      assert.equal(Object.hasOwn(args[0], 'params'), params !== undefined);
      if (params !== undefined) {
        assert.equal(JSON.stringify(args[0].params), JSON.stringify(params));
        if (!Array.isArray(params)) assert.equal(Object.getPrototypeOf(args[0].params), Object.prototype);
      }
      assert.deepEqual(Object.keys(args[0]), params === undefined ? ['query'] : ['query', 'params']);
      return result();
    } };
    const pending = perform(binding, query, bytes, '1:60000'); bytes.fill(0); await pending;
  }
  await perform({ query: () => result() }, 'q'.repeat(10240), encoder.encode(JSON.stringify(Array(100).fill(1))), '100:5000');
});

test('reject invalid requests before accessing binding, with no SQL rewrite or fake parser claim', async () => {
  const binding = { get query() { assert.fail('binding accessed'); } };
  for (const sql of ['', 1, '\ud800', 'q'.repeat(10241), '猫'.repeat(3414)]) await assert.rejects(perform(binding, sql, empty, '1:1'), /Analytics SQL/);
  for (const body of [[], new Uint8Array(65537), new Uint8Array([255]), encoder.encode('{')]) await assert.rejects(perform(binding, query, body, '1:1'));
  for (const params of [null, true, 'string', 1, [1e100], [null, {}], [[]], ['x'.repeat(4097)], ['\ud800'],
    Array(101).fill(1), { 'bad-name': 1 }, { ['k'.repeat(65)]: 1 }, Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['k' + i, 1]))])
    await assert.rejects(perform(binding, query, encoder.encode(JSON.stringify(params)), '1:1'));
  for (const options of [1, '0:1', '01:1', '1:01', '1:0', '1:1\n', '101:1', '1:60001']) await assert.rejects(perform(binding, query, empty, options), /Analytics SQL/);
  await assert.rejects(perform(binding, query, empty, '1:1', {}), /signal/);
  await assert.rejects(perform(binding, query, empty, '1:1', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, query, empty, '1:1'), /unavailable/);
});

test('selected result/stat fields read once, RPC roots released in reverse and borrowed binding excluded', async () => {
  const released = [], reads = [];
  const source = result([{ x: 'owned' }]), value = { [Symbol.dispose]() { released.push('value'); } };
  const stats = source.statistics; source.statistics = {};
  for (const key of Object.keys(stats)) Object.defineProperty(source.statistics, key, { get() { assert.equal(released.length, 0); reads.push('statistics.' + key); return stats[key]; } });
  for (const key of ['data', 'rows', 'statistics']) Object.defineProperty(value, key, { get() { assert.equal(released.length, 0); reads.push(key); return source[key]; } });
  const pending = Promise.resolve(value); pending[Symbol.dispose] = () => released.push('pending');
  const binding = { query: () => pending, [Symbol.dispose]() { assert.fail('borrowed'); } };
  await perform(binding, query, empty, '10:5000');
  assert.deepEqual(reads, ['data', 'rows', 'statistics', 'statistics.elapsed_ms', 'statistics.rows_read', 'statistics.bytes_read']); assert.deepEqual(released, ['value', 'pending']);
  Object.assign(binding, result()); binding.query = () => binding; await perform(binding, query, empty, '10:5000');
});

test('invalid counts/stats/rows/cells reject without coercion or getter execution', async () => {
  const accessor = {}; Object.defineProperty(accessor, 'x', { enumerable: true, get() { assert.fail('cell accessor'); } });
  const hidden = {}; Object.defineProperty(hidden, 'x', { value: 1 });
  const sparse = new Array(1);
  const bad = [null, [], {}, { ...result(), rows: 1 }, { ...result(), rows: -1 }, { ...result(), rows: 0.5 },
    { ...result(), statistics: null }, result(sparse), result([[]]), result([new Date()]), result([null]), result([accessor]), result([hidden]),
    result([{ [Symbol('x')]: 1 }]), result([{ '': 1 }]), result([{ ['n'.repeat(129)]: 1 }]),
    ...[undefined, {}, [], NaN, Infinity, 9007199254740992, 1n, new Date(), '\ud800', 'x'.repeat(4097)].map(value => result([{ x: value }])),
    result([Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['c' + i, null]))])];
  for (const field of ['elapsed_ms', 'rows_read', 'bytes_read']) for (const value of [-1, NaN, Infinity, '1', 9007199254740992]) bad.push({ ...result(), statistics: { ...result().statistics, [field]: value } });
  bad.push({ ...result(), statistics: { ...result().statistics, rows_read: 0.5 } });
  for (const value of bad) await assert.rejects(run(value), /Analytics SQL/);
  await assert.rejects(run(result([{}, {}]), '1:5000'), /result/);
});

test('byte cap is inclusive and independent of row/column caps; safe statistics retain integer precision', async () => {
  const data = Array.from({ length: 4 }, () => Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['c' + String(i).padStart(2, '0'), 'x'.repeat(4096)])));
  data[3].c63 = 'x'.repeat(212);
  const value = result(data); value.statistics = { elapsed_ms: 0, rows_read: Number.MAX_SAFE_INTEGER, bytes_read: Number.MAX_SAFE_INTEGER };
  const maximum = await run(value); assert.equal(maximum.bytes.length, 1048576);
  assert.equal(decode(maximum.bytes).statistics.rows_read, Number.MAX_SAFE_INTEGER);
  data[3].c63 += 'x'; await assert.rejects(run(value), /exceeds byte limit/);
});

test('cleanup, aliasing and primary retryable errors remain honest without automatic retry', async () => {
  await assert.rejects(run({ ...result(), [Symbol.dispose]() { throw new Error('cleanup'); } }), /cleanup/);
  await assert.rejects(run({ ...result(), rows: -1, [Symbol.dispose]() { throw new Error('cleanup'); } }), /Analytics SQL/);
  await assert.rejects(run({ ...result(), [Symbol.dispose]: 1 }), /disposer/);
  let count = 0;
  const alias = { ...result(), then(resolve) { delete this.then; resolve(this); }, [Symbol.dispose]() { ++count; } };
  await run(alias); assert.equal(count, 1);
  let calls = 0; const primary = Object.assign(new Error('provider failure'), { retryable: true });
  await assert.rejects(perform({ query() { ++calls; throw primary; } }, query, empty, '1:5000'), error => error === primary && error.retryable);
  assert.equal(calls, 1);
});

test('deadlines and abort drain late results/rejections and detach listeners', async () => {
  for (const mode of ['deadline', 'abort', 'reject']) {
    let resolve, reject, pendingReleases = 0, valueReleases = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending[Symbol.dispose] = () => { ++pendingReleases; };
    const controller = new AbortController();
    const outcome = perform({ query: () => pending }, query, empty, mode === 'deadline' ? '1:5' : '1:5000', controller.signal);
    const rejected = assert.rejects(outcome, { name: mode === 'deadline' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode !== 'deadline') controller.abort(); await rejected;
    if (mode === 'reject') reject(new Error('late failure'));
    else resolve({ ...result(), [Symbol.dispose]() { ++valueReleases; throw new Error('late cleanup'); } });
    await tick(); assert.equal(pendingReleases, 1); assert.equal(valueReleases, mode === 'reject' ? 0 : 1);
  }
  const controller = new AbortController(); let released = 0, removed = 0;
  const signal = controller.signal, remove = signal.removeEventListener.bind(signal);
  signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
  await assert.rejects(perform({ query() { controller.abort(); return { ...result(), [Symbol.dispose]() { ++released; } }; } }, query, empty, '1:5000', signal), { name: 'AbortError' });
  assert.equal(released, 1); assert.equal(removed, 1);
});
