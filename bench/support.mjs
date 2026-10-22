import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { aggregateReference, imageReference, makeImage, makeVectors, searchReference } from './oracle.mjs';

// The origin Worker every variant reaches through its ORIGIN service binding.
export const ORIGIN_CONFIG = 'bench/origin.wrangler.jsonc';

export function parseOptions(args) {
  const options = { rounds: 6, samples: 80, warmups: 10, warmupMs: 300, concurrency: 1 };
  const bounds = { rounds: [2, 20], samples: [5, 500], warmups: [0, 100], 'warmup-ms': [0, 10000], concurrency: [1, 16] };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2);
    const text = args[index + 1];
    if (!args[index].startsWith('--') || !Object.hasOwn(bounds, key) || seen.has(key) || !/^(0|[1-9]\d*)$/.test(text ?? ''))
      throw new Error('Use --rounds N --samples N --warmups N --warmup-ms N --concurrency N, each at most once');
    const value = Number(text);
    const [min, max] = bounds[key];
    if (!Number.isSafeInteger(value) || value < min || value > max || (key === 'rounds' && value % 2))
      throw new Error(`${key} out of bounds; rounds must be even`);
    options[key === 'warmup-ms' ? 'warmupMs' : key] = value;
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
  return { count: values.length, min: sorted[0], median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: sorted.at(-1) };
}

const TEXT = 'text/plain; charset=utf-8';
const BINARY = 'application/octet-stream';

function imagePayload(width, height, seed) {
  const body = makeImage(width, height, seed);
  return { body, expected: imageReference(body, width, height) };
}

function searchPayload(n, d, q, k, seed, spread) {
  const body = makeVectors(n + q, d, seed, spread);
  return { body, expected: searchReference(body, n, d, q, k) };
}

function aggregatePath(params) {
  return `/aggregate?items=${params.items}&parallel=${params.parallel}&bytes=${params.bytes}&delay=${params.delay}&seed=${params.seed}`;
}

// One fan-out case; each payload uses a different seed, so the path varies.
function aggregateCase(name, params, seeds) {
  return { name, path: aggregatePath({ ...params, seed: seeds[0] }), method: 'GET', contentType: BINARY,
    payloads: seeds.map(seed => ({ path: aggregatePath({ ...params, seed }), expected: aggregateReference({ ...params, seed }) })) };
}

// Compute cases cycle through four different payloads so no result can be cached.
const SEEDS = [1, 2, 3, 4];

let cached;
export function benchmarkCases() {
  if (cached) return cached;
  const body = length => Uint8Array.from({ length }, (_, index) => (index * 17 + 3) % 256);
  const cases = [{ name: 'hello', path: '/hello', method: 'GET', contentType: TEXT, payloads: [{ expected: Buffer.from('ok') }] }];
  // Echo 64 KiB and 1 MiB are the transport controls for image-256 and image-1024:
  // the same request and response sizes with no compute.
  for (const length of [1024, 65536, 1048576]) {
    const input = body(length);
    cases.push({ name: `echo-${length}`, path: '/echo', method: 'POST', contentType: TEXT, payloads: [{ body: input, expected: input }] });
  }
  for (const [iterations, length] of [[1, 1024], [16, 1024], [1, 65536]]) {
    const input = body(length);
    cases.push({ name: `sha256-${iterations}x-${length}`, path: `/digest/${iterations}`, method: 'POST', contentType: TEXT,
      payloads: [{ body: input, expected: Buffer.from(createHash('sha256').update(input).digest('hex')) }] });
  }
  for (const size of [256, 1024]) {
    cases.push({ name: `image-${size}`, path: `/image?w=${size}&h=${size}`, method: 'POST', contentType: BINARY,
      payloads: SEEDS.map(seed => imagePayload(size, size, seed)) });
  }
  // search-large keeps the request within libcf's 1 MiB request-body bridge limit.
  for (const [name, n, d, q, k] of [['search-small', 1024, 128, 1, 10], ['search-large', 8000, 128, 8, 10]]) {
    cases.push({ name, path: `/search?n=${n}&d=${d}&q=${q}&k=${k}`, method: 'POST', contentType: BINARY,
      payloads: SEEDS.map(seed => searchPayload(n, d, q, k, seed)) });
  }
  // I/O fan-out: each shard waits `delay` ms at the origin before its headers.
  // Serial, six and twelve outstanding requests, and larger 64 KiB shards.
  for (const [name, params] of [
    ['io-serial', { items: 12, parallel: 1, bytes: 4096, delay: 10 }],
    ['io-fanout-6', { items: 12, parallel: 6, bytes: 4096, delay: 10 }],
    ['io-fanout-12', { items: 12, parallel: 12, bytes: 4096, delay: 10 }],
    ['io-64k-6', { items: 8, parallel: 6, bytes: 65536, delay: 8 }],
  ]) cases.push(aggregateCase(name, params, SEEDS));
  return (cached = cases);
}

// Edge cases checked by the test suite, not timed: odd sizes that exercise the
// scalar tails, tie-heavy searches, and invalid requests.
export function correctnessCases() {
  const cases = [];
  for (const [w, h] of [[7, 7], [8, 9], [13, 7], [17, 33], [31, 12], [1031, 9]]) {
    cases.push({ name: `image-${w}x${h}`, path: `/image?w=${w}&h=${h}`, method: 'POST', contentType: BINARY,
      payloads: [imagePayload(w, h, w + h)] });
  }
  for (const [n, d, q, k, spread] of [[1, 16, 1, 1, 128], [40, 16, 3, 40, 1], [300, 32, 2, 10, 1], [100, 256, 16, 100, 2], [500, 48, 5, 7, 128]]) {
    cases.push({ name: `search-${n}-${d}-${q}-${k}`, path: `/search?n=${n}&d=${d}&q=${q}&k=${k}`, method: 'POST', contentType: BINARY,
      payloads: [searchPayload(n, d, q, k, n + d, spread)] });
  }
  for (const [name, params] of [
    ['aggregate-single', { items: 1, parallel: 1, bytes: 1, delay: 0 }],
    ['aggregate-wide', { items: 32, parallel: 32, bytes: 100, delay: 0 }],
    ['aggregate-parallel-above-items', { items: 3, parallel: 8, bytes: 777, delay: 1 }],
    ['aggregate-uneven-lanes', { items: 7, parallel: 3, bytes: 65536, delay: 2 }],
  ]) cases.push(aggregateCase(name, params, [999999]));
  const rejected = (name, path, length) => ({ name, path, method: 'POST', contentType: TEXT, status: 400,
    payloads: [{ body: new Uint8Array(length), expected: null }] });
  cases.push(
    rejected('image-too-small', '/image?w=6&h=7', 42),
    rejected('image-wrong-length', '/image?w=8&h=8', 63),
    rejected('image-leading-zero', '/image?w=08&h=8', 64),
    rejected('image-duplicate-key', '/image?w=8&w=8', 64),
    rejected('image-extra-key', '/image?w=8&h=8&x=1', 64),
    rejected('image-trailing-separator', '/image?w=8&h=8&', 64),
    rejected('search-bad-dimension', '/search?n=4&d=20&q=1&k=1', 100),
    rejected('search-k-above-n', '/search?n=4&d=16&q=1&k=5', 80),
    rejected('search-too-many-queries', '/search?n=4&d=16&q=17&k=1', 336),
    rejected('aggregate-no-items', '/aggregate?items=0&parallel=1&bytes=1&delay=0&seed=1', 0),
    rejected('aggregate-too-parallel', '/aggregate?items=1&parallel=33&bytes=1&delay=0&seed=1', 0),
    rejected('aggregate-shard-too-large', '/aggregate?items=1&parallel=1&bytes=65537&delay=0&seed=1', 0),
    rejected('aggregate-missing-seed', '/aggregate?items=1&parallel=1&bytes=1&delay=0', 0),
  );
  return cases;
}

// Times one request (payload `index` cycles through the scenario's payloads),
// then checks status, content type and every response byte outside the timer.
export async function sample(base, scenario, index = 0) {
  const payload = scenario.payloads[index % scenario.payloads.length];
  const start = performance.now();
  const response = await fetch(`${base}${payload.path ?? scenario.path}`, {
    method: scenario.method, body: payload.body, signal: AbortSignal.timeout(10000),
  });
  const actual = Buffer.from(await response.arrayBuffer());
  const elapsed = performance.now() - start;
  assert.equal(response.status, scenario.status ?? 200, scenario.name);
  assert.equal(response.headers.get('content-type'), scenario.contentType, scenario.name);
  if (payload.expected) assert(actual.equals(Buffer.from(payload.expected)), `incorrect body: ${scenario.name}`);
  return elapsed;
}
