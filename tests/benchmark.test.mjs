import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions, summarize, benchmarkCases } from '../bench/support.mjs';
test('benchmark options are bounded and use balanced execution rounds', () => {
  assert.deepEqual(parseOptions([]), { rounds: 6, samples: 80, warmups: 10 });
  assert.deepEqual(parseOptions(['--rounds', '2', '--samples', '5', '--warmups', '0']), { rounds: 2, samples: 5, warmups: 0 });
  for (const args of [['--rounds', '3'], ['--samples', '0'], ['--samples', '501'], ['--warmups', '-1'],
    ['--samples', '5x'], ['--rounds'], ['--unknown', '2'], ['--samples', '5', '--samples', '6'], ['--rounds', '1e2']])
    assert.throws(() => parseOptions(args));
});
test('statistics use linear interpolation, preserve negative deltas and reject invalid data', () => {
  const result = summarize([4, 1, 3, 2]);
  assert.equal(result.count, 4);
  assert.equal(result.min, 1);
  assert.equal(result.median, 2.5);
  assert(Math.abs(result.p95 - 3.85) < 1e-12);
  assert.equal(result.max, 4);
  assert.equal(summarize([-2, -1]).median, -1.5);
  for (const values of [[], [NaN], [Infinity], Array(2)]) assert.throws(() => summarize(values));
  assert.equal(benchmarkCases().length, 7);
});
