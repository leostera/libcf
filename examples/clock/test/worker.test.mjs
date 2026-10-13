import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/clock/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
async function sample(path, count) {
  const before = Date.now();
  const response = await fetch(`${worker.base}${path}`);
  assert.equal(response.status, 200);
  const values = (await response.text()).split(' ').map(Number);
  const after = Date.now();
  assert.equal(values.length, count);
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
