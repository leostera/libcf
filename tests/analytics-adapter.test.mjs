import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAnalytics, performAnalytics } from '../lib/analytics.mjs';
// Shared expected encoding with the C++ native test, including negative zero.
const golden = () => Uint8Array.from(Buffer.from('02000000000000000000f83f000000000000008003000000010000000100000078020000000200000000ff000000000000000001000000010000000100000069', 'hex'));
test('analytics codec preserves doubles, text, binary, null and one index', () => {
  let captured;
  const result = performAnalytics({ writeDataPoint(point) { captured = point; } }, golden());
  assert.equal(result.status, 0);
  assert.deepEqual(captured.doubles, [1.5, -0]);
  assert.equal(captured.blobs[0], 'x');
  assert.deepEqual(new Uint8Array(captured.blobs[1]), Uint8Array.of(0, 255));
  assert.equal(captured.blobs[2], null);
  assert.deepEqual(captured.indexes, ['i']);
});

test('analytics decoder rejects malformed data before calling the host', () => {
  const host = { writeDataPoint() { assert.fail('invalid point reached host'); } };
  const nonfinite = golden();
  new DataView(nonfinite.buffer).setFloat64(4, Infinity, true);
  const count = golden();
  new DataView(count.buffer).setUint32(0, 21, true);
  const indexCount = golden();
  new DataView(indexCount.buffer).setUint32(51, 2, true);
  for (const bytes of [new Uint8Array(), golden().slice(0, -1), Uint8Array.from([...golden(), 0]), nonfinite, count, indexCount, new Uint8Array(16821)])
    assert.throws(() => performAnalytics(host, bytes));
  assert.deepEqual(decodeAnalytics(new Uint8Array(12)), { doubles: [], blobs: [], indexes: [] });
});
