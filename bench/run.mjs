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
  for (const label of order(round)) {
    const setupStart = performance.now();
    const worker = await startLocalWorker(variants[label].config);
    const setupMilliseconds = performance.now() - setupStart;
    try {
      const measurements = {};
      for (const scenario of scenarios) {
        for (let index = 0; index < options.warmups; index++) await sample(worker.base, scenario);
        const samples = [];
        for (let index = 0; index < options.samples; index++) samples.push(await sample(worker.base, scenario));
        measurements[scenario.name] = { milliseconds: summarize(samples), samples };
      }
      runs.push({ round, label, setupMilliseconds, measurements });
    } finally { await worker.dispose(); }
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
  schemaVersion: 3, measuredAt: new Date().toISOString(), ...revisionInfo(), sourceFingerprint: before,
  host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  versions: { node: process.version, emscripten: '6.0.12 (pinned Bazel emsdk)',
    rust: '1.98.0 (pinned rules_rust)', workersRs: 'worker 0.8.7', wasmBindgen: '0.2.129', binaryen: '132',
    esbuild: await version('esbuild'), miniflare: await version('miniflare'), workerd: workerdVersion },
  compatibilityDate: '2026-10-13', options, buildMilliseconds, artifacts, summary, comparisons,
  incrementalDigestBridgeEstimateMilliseconds: {
    cppMinusJs: summarize(incremental.map(value => value.cppMinusJs)),
    cppMinusRust: summarize(incremental.map(value => value.cppMinusRust)) }, runs,
  limitations: [
    'Sequential localhost HTTP including client/server buffering; not production edge latency or throughput.',
    'Setup includes esbuild, local workerd and first-response Wasm initialization, not isolated engine startup.',
    'Incremental estimate subtracts 1-call from 16-call medians, then the comparator from C++; includes copies, allocations and coroutine scheduling, not just ABI instructions.',
    'Quantiles use linear interpolation; no confidence intervals or statistical-significance claims.',
    'Bundle bytes sum ESM and Wasm; gzip uses per-module level 9, excluding upload/config framing.',
    'Rotating variant order reduces but does not eliminate host load, cache, thermal and order effects.',
    'No CPU/memory profiling or production cold-start measurement; source hashes record declared runfile inputs, and artifact hashes identify the measured modules.',
    'Bazel compilation completes before measurement; buildMilliseconds is null, not a measured build duration.',
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.table(scenarios.map(scenario => ({ scenario: scenario.name,
  jsMs: summary.js.scenarios[scenario.name].median.toFixed(3),
  cppMs: summary.cpp.scenarios[scenario.name].median.toFixed(3),
  rustMs: summary.rust.scenarios[scenario.name].median.toFixed(3),
  cppVsRustRatio: comparisons[scenario.name]['cpp-rust'].pairedMedianRatio.median.toFixed(3) })));
console.table(Object.fromEntries(Object.entries(artifacts).map(([label, value]) => [label, { bytes: value.bytes, gzipBytes: value.gzipBytes }])));
console.log(`Wrote ${reportPath} (raw samples, versions, hashes and limitations).`);
