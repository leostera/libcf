import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeResult, encodeBatch } from '../lib/sql.mjs';

test('SQL cursors are consumed before metadata and before advancing the batch', () => {
  const events = [];
  function* results() {
    for (let i = 0; i < 2; i++) {
      events.push(`execute ${i}`);
      yield {
        results: (function* () { events.push(`consume ${i}`); yield { value: i }; })(),
        meta: () => { events.push(`metadata ${i}`); return { rowsRead: 1 }; },
      };
    }
  }
  const bytes = encodeBatch(results());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 2);
  assert.deepEqual(events, ['execute 0', 'consume 0', 'metadata 0', 'execute 1', 'consume 1', 'metadata 1']);
});

test('bounded SQL encoding stops consuming an oversized cursor', () => {
  let consumed = 0;
  let closed = false;
  function* rows() {
    try {
      for (let i = 0; i < 100000; i++) { consumed++; yield { value: 'x'.repeat(1024) }; }
    } finally { closed = true; }
  }
  assert.throws(() => encodeResult({ results: rows(), meta: {} }), /4 MiB/);
  assert(consumed < 5000);
  assert(closed);
});

test('batch size rejection stops before dispatching another statement', () => {
  let executed = 0;
  function* results() {
    for (let i = 0; i < 10; i++) {
      executed++;
      yield { results: [{ value: 'x'.repeat(3 * 1024 * 1024) }], meta: {} };
    }
  }
  assert.throws(() => encodeBatch(results()), /4 MiB/);
  assert.equal(executed, 2);
});
