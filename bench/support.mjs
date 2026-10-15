import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function parseOptions(args) {
  const options = { rounds: 6, samples: 80, warmups: 10 };
  const bounds = { rounds: [2, 20], samples: [5, 500], warmups: [0, 100] };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2);
    const text = args[index + 1];
    if (!args[index].startsWith('--') || !Object.hasOwn(bounds, key) || seen.has(key) || !/^(0|[1-9]\d*)$/.test(text ?? ''))
      throw new Error('Use --rounds N --samples N --warmups N, each at most once');
    const value = Number(text);
    const [min, max] = bounds[key];
    if (!Number.isSafeInteger(value) || value < min || value > max || (key === 'rounds' && value % 2))
      throw new Error(`${key} out of bounds; rounds must be even`);
    options[key] = value;
    seen.add(key);
  }
  return options;
}

export function summarize(values) {
  const sorted = [...values];
  if (!sorted.length || sorted.some(value => !Number.isFinite(value))) throw new Error('finite samples required');
  sorted.sort((a, b) => a - b);
  const quantile = probability => {
    const rank = (sorted.length - 1) * probability;
    const lower = Math.floor(rank);
    return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower);
  };
  return { count: values.length, min: sorted[0], median: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1) };
}

export function benchmarkCases() {
  const body = length => Uint8Array.from({ length }, (_, index) => (index * 17 + 3) % 256);
  const cases = [{ name: 'hello', path: '/hello', method: 'GET', expected: Buffer.from('ok') }];
  for (const length of [1024, 65536, 1048576]) {
    const input = body(length);
    cases.push({ name: `echo-${length}`, path: '/echo', method: 'POST', body: input, expected: input });
  }
  for (const [iterations, length] of [[1, 1024], [16, 1024], [1, 65536]]) {
    const input = body(length);
    cases.push({ name: `sha256-${iterations}x-${length}`, path: `/digest/${iterations}`, method: 'POST', body: input,
      expected: Buffer.from(createHash('sha256').update(input).digest('hex')) });
  }
  return cases;
}

export async function sample(base, scenario) {
  const start = performance.now();
  const response = await fetch(`${base}${scenario.path}`, {
    method: scenario.method, body: scenario.body, signal: AbortSignal.timeout(10000),
  });
  const actual = Buffer.from(await response.arrayBuffer());
  const elapsed = performance.now() - start;
  // Correctness checks are outside the latency timer, but every result is checked.
  assert.equal(response.status, 200, scenario.name);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', scenario.name);
  assert(actual.equals(Buffer.from(scenario.expected)), `incorrect body: ${scenario.name}`);
  return elapsed;
}
