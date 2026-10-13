import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { benchmarkCases, parseOptions, sample, summarize } from './benchmark-support.mjs';

const options = parseOptions(process.argv.slice(2));
const variants = {
  js: { entry: 'examples/benchmark/plain.mjs', config: 'examples/benchmark/plain.wrangler.jsonc' },
  cpp: { entry: 'examples/benchmark/worker.mjs', config: 'examples/benchmark/wrangler.jsonc' },
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8' }).trim();

async function sourceFingerprint() {
  const files = ['scripts/bench-sdk.mjs', 'scripts/benchmark-support.mjs', 'scripts/build-worker.mjs',
    'examples/test/local-worker.mjs', 'examples/test/jsonc.mjs', 'package-lock.json', '.node-version'];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.(hpp|h|cpp|js|mjs|jsonc)$/.test(entry.name)) files.push(path);
    }
  }
  for (const directory of ['include/cf', 'lib', 'src', 'examples/benchmark']) await visit(directory);
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
const compileStart = performance.now();
execFileSync(process.execPath, ['scripts/build-worker.mjs', variants.cpp.config], { stdio: 'inherit' });
const buildMilliseconds = performance.now() - compileStart;
const artifacts = {};
for (const [label, variant] of Object.entries(variants)) artifacts[label] = await bundleMetrics(label, variant.entry);
const scenarios = benchmarkCases();
const runs = [];
for (let round = 0; round < options.rounds; round++) {
  for (const label of round % 2 ? ['cpp', 'js'] : ['js', 'cpp']) {
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
  const deltas = [];
  for (let round = 0; round < options.rounds; round++) {
    const median = label => runs.find(run => run.round === round && run.label === label).measurements[scenario.name].milliseconds.median;
    deltas.push(median('cpp') - median('js'));
  }
  comparisons[scenario.name] = { pairedMedianDeltaMilliseconds: summarize(deltas) };
}
for (let round = 0; round < options.rounds; round++) {
  const cost = label => {
    const measurements = runs.find(run => run.round === round && run.label === label).measurements;
    return (measurements['sha256-16x-1024'].milliseconds.median - measurements['sha256-1x-1024'].milliseconds.median) / 15;
  };
  incremental.push(cost('cpp') - cost('js'));
}
const version = async name => JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8')).version;
const report = {
  schemaVersion: 1, measuredAt: new Date().toISOString(), baseRevision: command('git', ['rev-parse', 'HEAD']),
  dirtyWorktree: Boolean(command('git', ['status', '--porcelain'])), sourceFingerprint: before,
  host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  versions: { node: process.version, emscripten: command('em++', ['--version']).split('\n')[0],
    esbuild: await version('esbuild'), miniflare: await version('miniflare'), workerd: await version('workerd') },
  compatibilityDate: '2026-10-13', options, buildMilliseconds, artifacts, summary, comparisons,
  incrementalDigestBridgeEstimateMilliseconds: summarize(incremental), runs,
  limitations: [
    'Sequential localhost HTTP including client/server buffering; not production edge latency or throughput.',
    'Setup includes esbuild, local workerd and first-response Wasm initialization, not isolated engine startup.',
    'Incremental estimate subtracts 1-call from 16-call medians, then JS from C++; includes copies, allocations and coroutine scheduling, not just ABI instructions.',
    'Quantiles use linear interpolation; no confidence intervals or statistical-significance claims.',
    'Bundle bytes sum ESM and Wasm; gzip uses per-module level 9, excluding upload/config framing.',
    'Alternating variant order reduces but does not eliminate host load, cache, thermal and order effects.',
    'No CPU/memory profiling or production cold-start measurement; source hashes record the dirty worktree actually measured.',
  ],
};
await mkdir('build/benchmark', { recursive: true });
await writeFile('build/benchmark/report.json', JSON.stringify(report, null, 2) + '\n');
console.table(scenarios.map(scenario => ({ scenario: scenario.name,
  jsMedianMs: summary.js.scenarios[scenario.name].median.toFixed(3),
  cppMedianMs: summary.cpp.scenarios[scenario.name].median.toFixed(3),
  pairedDeltaMs: comparisons[scenario.name].pairedMedianDeltaMilliseconds.median.toFixed(3) })));
console.log('Wrote build/benchmark/report.json (raw samples, versions, hashes and limitations).');
