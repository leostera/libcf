// Counts JS<->Wasm boundary crossings per request for the C++ and Rust fixtures.
// A wrapper entry patches WebAssembly.Instance before the fixture module loads,
// wrapping every imported and exported function with a counter. Counts are
// diagnostic only; the wrappers add overhead, so this is never used for timing.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { ORIGIN_CONFIG, benchmarkCases, sample } from './support.mjs';

const COUNTER = `
const counts = globalThis.__libcfBoundary = { imports: {}, exports: {} };
// Look the table up per call: the reader replaces tables when it resets them.
const wrap = (kind, name, fn) => function (...args) { const table = counts[kind]; table[name] = (table[name] ?? 0) + 1; return fn.apply(this, args); };
const Original = WebAssembly.Instance;
WebAssembly.Instance = function Instance(module, imports = {}) {
  const wrappedImports = {};
  for (const [space, values] of Object.entries(imports)) {
    wrappedImports[space] = {};
    for (const [name, value] of Object.entries(values))
      wrappedImports[space][name] = typeof value === 'function' ? wrap('imports', name, value) : value;
  }
  const instance = new Original(module, wrappedImports);
  const exports = {};
  for (const [name, value] of Object.entries(instance.exports))
    exports[name] = typeof value === 'function' ? wrap('exports', name, value) : value;
  return { exports: Object.freeze(exports) };
};
`;

const wrapper = entry => `
import './counter.mjs';
import Real from ${JSON.stringify(entry)};
const take = () => { const value = JSON.stringify(globalThis.__libcfBoundary); globalThis.__libcfBoundary.imports = {}; globalThis.__libcfBoundary.exports = {}; return value; };
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/__boundary') return new Response(take());
    const target = typeof Real === 'function' ? new Real(ctx, env) : Real;
    return target.fetch(request, env, ctx);
  },
};
`;

const variants = { cpp: 'bench/worker.mjs', rust: 'bench/rust-worker.mjs' };
const root = await mkdtemp(join(tmpdir(), 'libcf-boundary-'));
const sum = table => Object.values(table).reduce((total, value) => total + value, 0);
try {
  const report = {};
  for (const [label, entry] of Object.entries(variants)) {
    const directory = join(root, label);
    await import('node:fs/promises').then(fs => fs.mkdir(directory));
    await writeFile(join(directory, 'counter.mjs'), COUNTER);
    await writeFile(join(directory, 'entry.mjs'), wrapper(resolve(entry)));
    await writeFile(join(directory, 'wrangler.jsonc'), JSON.stringify({
      name: `libcf-boundary-${label}`, main: 'entry.mjs', compatibility_date: '2026-10-13',
      services: [{ binding: 'ORIGIN', service: 'libcf-benchmark-origin' }] }));
    const worker = await startLocalWorker(join(directory, 'wrangler.jsonc'), { additionalConfigs: [ORIGIN_CONFIG] });
    try {
      const counts = async () => JSON.parse(await (await fetch(`${worker.base}/__boundary`)).text());
      report[label] = {};
      for (const scenario of benchmarkCases()) {
        await sample(worker.base, scenario); // warm up lazy initialization
        await counts();
        await sample(worker.base, scenario);
        const { imports, exports } = await counts();
        report[label][scenario.name] = { importCalls: sum(imports), exportCalls: sum(exports), imports, exports };
      }
    } finally { await worker.dispose(); }
  }
  console.table(Object.fromEntries(benchmarkCases().map(({ name }) => [name, {
    cppImports: report.cpp[name].importCalls, cppExports: report.cpp[name].exportCalls,
    rustImports: report.rust[name].importCalls, rustExports: report.rust[name].exportCalls }])));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { await rm(root, { recursive: true, force: true }); }
