import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { benchmarkCases, parseOptions, sample, summarize } from './support.mjs';

const [reportPath, ...args] = process.argv.slice(2);
if (!reportPath || !isAbsolute(reportPath)) throw new Error('Pass a new absolute report path, followed by benchmark options');
const options = parseOptions(args);
const variants = {
  js: { entry: 'bench/plain.mjs', config: 'bench/plain.wrangler.jsonc' },
  cpp: { entry: 'bench/worker.mjs', config: 'bench/wrangler.jsonc' },
  rust: { entry: 'bench/rust-worker.mjs', config: 'bench/rust.wrangler.jsonc' },
};
// Rotate the start variant each round to spread order effects across variants.
const order = round => { const labels = Object.keys(variants); return labels.map((_, i) => labels[(i + round) % labels.length]); };
const PAIRS = [['cpp', 'js'], ['cpp', 'rust'], ['rust', 'js']];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8' }).trim();
function revisionInfo() {
  const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
  if (!workspace) return { baseRevision: null, dirtyWorktree: null };
  try {
    return { baseRevision: command('git', ['-C', workspace, 'rev-parse', 'HEAD']),
      dirtyWorktree: Boolean(command('git', ['-C', workspace, 'status', '--porcelain'])) };
  } catch { return { baseRevision: null, dirtyWorktree: null }; }
}

async function sourceFingerprint() {
  const files = ['bench/run.mjs', 'bench/support.mjs',
    'examples/test/local-worker.mjs', 'examples/test/jsonc.mjs', 'pnpm-lock.yaml',
    'MODULE.bazel', 'MODULE.bazel.lock', 'BUILD.bazel', '.bazelversion', '.bazelrc', 'cf-0.1.0.tar.gz'];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.(hpp|h|cpp|js|mjs|jsonc|rs|toml|lock|wasm)$/.test(entry.name)) files.push(path);
    }
  }
  for (const directory of ['include/cf', 'lib', 'src', 'bench', 'build/benchmark_rust']) await visit(directory);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    const bytes = await readFile(path);
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

async function bundleMetrics(label, entry) {
  const modules = new Map();
  const result = await build({ entryPoints: [entry], outfile: `build/benchmark/${label}/worker.mjs`, write: false,
    bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:*'],
    plugins: [{ name: 'compiled-wasm', setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, async args => {
        const name = basename(args.path);
        if (modules.has(name)) throw new Error('duplicate Wasm module name');
        modules.set(name, await readFile(resolve(args.resolveDir, args.path)));
        return { path: `./${name}`, external: true };
      });
    } }],
  });
  modules.set('worker.mjs', result.outputFiles[0].contents);
  const members = [...modules].map(([name, bytes]) => ({ name, bytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: sha256(bytes) }));
  return { modules: members, bytes: members.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: members.reduce((sum, file) => sum + file.gzipBytes, 0) };
}

const before = await sourceFingerprint();
// Bazel completes compilation before this process starts; do not present run-time
// setup as compiler time or depend on a compiler installed on PATH.
const buildMilliseconds = null;
const artifacts = {};
for (const [label, variant] of Object.entries(variants)) artifacts[label] = await bundleMetrics(label, variant.entry);
const scenarios = benchmarkCases();
const runs = [];
for (let round = 0; round < options.rounds; round++) {
  // All variants run side by side. Every sample index requests each variant once,
  // in rotating order, so host load drift falls on all variants alike.
  const labels = order(round);
  const workers = {};
  const setup = {};
  try {
    for (const label of labels) {
      const setupStart = performance.now();
      workers[label] = await startLocalWorker(variants[label].config);
      setup[label] = performance.now() - setupStart;
    }
    const measurements = Object.fromEntries(labels.map(label => [label, {}]));
    // One slot sends `concurrency` simultaneous requests to one variant and
    // records each latency; payloads cycle so no variant can cache a result.
    const slot = async (label, scenario, index) => Promise.all(Array.from({ length: options.concurrency },
      (_, lane) => sample(workers[label].base, scenario, index * options.concurrency + lane)));
    for (const scenario of scenarios) {
      const samples = Object.fromEntries(labels.map(label => [label, []]));
      // Warm up for at least `warmups` slots and `warmupMs`, so JITs settle on slow cases too.
      const warmStart = performance.now();
      let index = 0;
      for (; index < options.warmups || performance.now() - warmStart < options.warmupMs; index++)
        for (let offset = 0; offset < labels.length; offset++)
          await slot(labels[(index + offset) % labels.length], scenario, index);
      for (let measured = 0; measured < options.samples; measured++, index++) {
        for (let offset = 0; offset < labels.length; offset++) {
          const label = labels[(index + offset) % labels.length];
          samples[label].push(...await slot(label, scenario, index));
        }
      }
      for (const label of labels)
        measurements[label][scenario.name] = { milliseconds: summarize(samples[label]), samples: samples[label] };
    }
    for (const label of labels)
      runs.push({ round, label, setupMilliseconds: setup[label], measurements: measurements[label] });
  } finally {
    for (const worker of Object.values(workers)) await worker.dispose();
  }
}
const after = await sourceFingerprint();
if (before.sha256 !== after.sha256) throw new Error('Source changed during benchmark; refusing to publish mixed measurements');
const summary = {};
for (const label of Object.keys(variants)) {
  const selected = runs.filter(run => run.label === label);
  summary[label] = { setupMilliseconds: summarize(selected.map(run => run.setupMilliseconds)), scenarios: {} };
  for (const scenario of scenarios)
    summary[label].scenarios[scenario.name] = summarize(selected.flatMap(run => run.measurements[scenario.name].samples));
}
const comparisons = {};
const incremental = [];
for (const scenario of scenarios) {
  const median = (round, label) => runs.find(run => run.round === round && run.label === label).measurements[scenario.name].milliseconds.median;
  comparisons[scenario.name] = {};
  for (const [a, b] of PAIRS) {
    const deltas = [], ratios = [];
    for (let round = 0; round < options.rounds; round++) {
      deltas.push(median(round, a) - median(round, b));
      ratios.push(median(round, a) / median(round, b));
    }
    comparisons[scenario.name][`${a}-${b}`] = { pairedMedianDeltaMilliseconds: summarize(deltas), pairedMedianRatio: summarize(ratios) };
  }
}
for (let round = 0; round < options.rounds; round++) {
  const cost = label => {
    const measurements = runs.find(run => run.round === round && run.label === label).measurements;
    return (measurements['sha256-16x-1024'].milliseconds.median - measurements['sha256-1x-1024'].milliseconds.median) / 15;
  };
  incremental.push({ cppMinusJs: cost('cpp') - cost('js'), cppMinusRust: cost('cpp') - cost('rust') });
}
const version = async name => JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8')).version;
const require = createRequire(import.meta.url);
const miniflareRequire = createRequire(require.resolve('miniflare'));
const workerdVersion = JSON.parse(await readFile(miniflareRequire.resolve('workerd/package.json'), 'utf8')).version;
const report = {
  schemaVersion: 5, measuredAt: new Date().toISOString(), ...revisionInfo(), sourceFingerprint: before,
  host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  versions: { node: process.version, emscripten: '6.0.12 (pinned Bazel emsdk)',
    rust: '1.98.0 (pinned rules_rust)', workersRs: 'worker 0.8.7', wasmBindgen: '0.2.129', binaryen: '132',
    esbuild: await version('esbuild'), miniflare: await version('miniflare'), workerd: workerdVersion },
  compatibilityDate: '2026-10-13', options, buildMilliseconds, artifacts, summary, comparisons,
  incrementalDigestBridgeEstimateMilliseconds: {
    cppMinusJs: summarize(incremental.map(value => value.cppMinusJs)),
    cppMinusRust: summarize(incremental.map(value => value.cppMinusRust)) }, runs,
  limitations: [
    'Localhost HTTP including client/server buffering (sequential unless --concurrency is set); not production edge latency or throughput.',
    'Setup includes esbuild, local workerd and first-response Wasm initialization, not isolated engine startup.',
    'Incremental estimate subtracts 1-call from 16-call medians, then the comparator from C++; includes copies, allocations and coroutine scheduling, not just ABI instructions.',
    'Quantiles use linear interpolation; no confidence intervals or statistical-significance claims.',
    'Bundle bytes sum ESM and Wasm; gzip uses per-module level 9, excluding upload/config framing.',
    'Compute workloads follow the bitemyapp/workerd-compute-bench specification, re-implemented; search-large is reduced to 8000 candidates to fit the 1 MiB request bridge limit.',
    'Variants run concurrently with per-sample interleaving in rotating order; this cancels slow load drift but not contention between the idle runtimes or fast load changes.',
    'No CPU/memory profiling or production cold-start measurement; source hashes record declared runfile inputs, and artifact hashes identify the measured modules.',
    'Bazel compilation completes before measurement; buildMilliseconds is null, not a measured build duration.',
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
// Absolute medians in ms, with the C++/Rust multiplier of those same medians.
console.table(Object.fromEntries(scenarios.map(({ name }) => {
  const median = label => summary[label].scenarios[name].median;
  return [name, { 'JS ms': median('js').toFixed(3), 'C++ ms': median('cpp').toFixed(3), 'Rust ms': median('rust').toFixed(3),
    'C++ vs Rust': `${(median('cpp') / median('rust')).toFixed(2)}x` }];
})));
console.table(Object.fromEntries(Object.entries(artifacts).map(([label, value]) => [label, { bytes: value.bytes, gzipBytes: value.gzipBytes }])));
console.log(`Wrote ${reportPath} (raw samples, versions, hashes and limitations).`);
