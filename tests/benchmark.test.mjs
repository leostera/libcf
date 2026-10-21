import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions, summarize, benchmarkCases, correctnessCases } from '../bench/support.mjs';
import { image, parseQuery, search } from '../bench/kernels.mjs';
import { imageReference, makeImage, makeVectors, searchReference } from '../bench/oracle.mjs';
test('benchmark options are bounded and use balanced execution rounds', () => {
  assert.deepEqual(parseOptions([]), { rounds: 6, samples: 80, warmups: 10, warmupMs: 300, concurrency: 1 });
  assert.deepEqual(parseOptions(['--rounds', '2', '--samples', '5', '--warmups', '0', '--warmup-ms', '0', '--concurrency', '4']),
    { rounds: 2, samples: 5, warmups: 0, warmupMs: 0, concurrency: 4 });
  for (const args of [['--rounds', '3'], ['--samples', '0'], ['--samples', '501'], ['--warmups', '-1'],
    ['--samples', '5x'], ['--rounds'], ['--unknown', '2'], ['--samples', '5', '--samples', '6'], ['--rounds', '1e2'],
    ['--concurrency', '0'], ['--concurrency', '17'], ['--warmup-ms', '10001']])
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
  assert.equal(result.p99 <= result.max && result.p99 >= result.p95, true);
  assert.equal(benchmarkCases().length, 11);
  for (const scenario of [...benchmarkCases(), ...correctnessCases()]) assert(scenario.payloads.length >= 1, scenario.name);
});
test('optimized JS kernels match the reference implementations, including scalar tails and ties', () => {
  for (const [w, h] of [[7, 7], [8, 9], [13, 7], [33, 17], [1031, 13]]) {
    const pixels = makeImage(w, h, w * h);
    assert.deepEqual(image(pixels, w, h), imageReference(pixels, w, h), `${w}x${h}`);
  }
  for (const [n, d, q, k, spread] of [[1, 16, 1, 1, 128], [50, 16, 3, 50, 1], [300, 32, 2, 10, 1], [100, 256, 16, 100, 2]]) {
    const input = makeVectors(n + q, d, n, spread);
    assert.deepEqual(search(input, n, d, q, k), searchReference(input, n, d, q, k), `${n}-${d}-${q}-${k}`);
  }
  assert.deepEqual(parseQuery('?w=7&h=8', ['w', 'h']), { w: 7, h: 8 });
  for (const query of ['?w=07&h=8', '?w=7&w=8', '?w=7&h=8&', '?w=7', '?w=7&h=8&x=1', '?w=-1&h=8', ''])
    assert.equal(parseQuery(query, ['w', 'h']), null, query);
});
