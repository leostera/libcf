import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/clock/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
async function sample(path, count) {
  const before = Date.now();
  const response = await fetch(`${worker.base}${path}`);
  const body = await response.text();
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}: ${body}`);
  const values = body.split(' ').map(Number);
  const after = Date.now();
  assert.equal(values.length, count);
  const reference = ['x-js-clock-before', 'x-js-clock-after'].map(name => {
    const text = response.headers.get(name);
    assert.match(text ?? '', /^-?\d+$/);
    const value = Number(text);
    assert(Number.isSafeInteger(value));
    return value;
  });
  for (const value of values) assert(value >= Math.min(...reference) && value <= Math.max(...reference));
  for (const value of values) {
    assert(Number.isSafeInteger(value));
    // Same-machine plausibility, not a precision or remote clock-sync claim.
    assert(value >= before - 1000 && value <= after + 1000);
  }
}
test('wall-clock f64 import preserves Unix milliseconds and stays frozen without I/O', async () => {
  await sample('/now', 1);
  await sample('/same-turn', 1);
});
test('clock remains usable after awaited I/O and for concurrent owned requests', async () => {
  await sample('/after-sleep', 2);
  await Promise.all(Array.from({ length: 8 }, () => sample('/now', 1)));
});
