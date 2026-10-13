import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile, cp } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

// Build only: no network calls or implicit deployment. Each build receives an
// isolated name; all live URLs stay within the user-approved DNS namespace.
const example = process.argv[2];
const bindingId = process.argv[3];
if (!['cache', 'd1', 'kv', 'r2', 'core', 'service', 'durable'].includes(example))
  throw new Error('Choose cache, d1, kv, r2, core, service or durable');
if (example === 'd1' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bindingId ?? ''))
  throw new Error('D1 requires the UUID of an isolated test database');
if (['kv', 'core'].includes(example) && !/^[a-f0-9]{32}$/.test(bindingId ?? ''))
  throw new Error('KV requires the ID of an isolated test namespace');
if (example === 'r2' && !/^libcf-r2-[a-f0-9]{10}$/.test(bindingId ?? ''))
  throw new Error('R2 requires an isolated libcf test bucket name');
if (['cache', 'service', 'durable'].includes(example) && bindingId) throw new Error('No resource binding ID is required');
const name = `libcf-${example}-${randomBytes(5).toString('hex')}`;
const upstreamName = example === 'service' ? `${name}-upstream` : undefined;
const env = {
  cache: {},
  d1: { DB: { type: 'd1', id: bindingId } },
  kv: { DEMO_KV: { type: 'kv', id: bindingId } },
  r2: { BUCKET: { type: 'r2', name: bindingId } },
  core: {
    STATE_KV: { type: 'kv', id: bindingId },
    ASSETS: { type: 'assets' },
    GREETING: { type: 'text', value: 'hello-from-env' },
  },
  service: { UPSTREAM: { type: 'worker', worker: upstreamName } },
  durable: { COUNTERS: { type: 'durable-object', worker: name, exportName: 'Counter' } },
}[example];
const hostname = `${name}.libcf.leostera.dev`;
const root = resolve(`build/live-${example}`);
const output = `${root}/.cloudflare/output/v0`;
const worker = `${output}/workers/default`;
const bundle = `${worker}/bundle`;
await mkdir(bundle, { recursive: true });
const wasmModules = new Map();
await build({
  entryPoints: [`examples/${example}/worker.mjs`],
  outfile: `${bundle}/worker.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  external: ['cloudflare:*'],
  plugins: [{
    name: 'precompiled-wasm',
    setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, args => {
        const source = resolve(args.resolveDir, args.path);
        const name = basename(source);
        if (wasmModules.has(name) && wasmModules.get(name) !== source) throw new Error('Wasm module basename collision');
        wasmModules.set(name, source);
        return { path: `./${name}`, external: true };
      });
    },
  }],
});
for (const [name, source] of wasmModules) await copyFile(source, `${bundle}/${name}`);
if (example === 'core') await cp('examples/core/public', `${worker}/assets`, { recursive: true });
if (upstreamName) {
  const upstream = `${output}/workers/upstream`;
  await mkdir(`${upstream}/bundle`, { recursive: true });
  await copyFile('examples/service/upstream/worker.mjs', `${upstream}/bundle/worker.mjs`);
  await writeFile(`${upstream}/worker.config.json`, JSON.stringify({
    name: upstreamName,
    compatibilityDate: '2026-10-13',
    workersDev: false,
    previewUrls: false,
    domains: [],
    observability: { enabled: true, traces: { enabled: true } },
    manifest: { type: 'complete', mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' } } },
  }, null, 2));
}
await writeFile(`${output}/config.json`, JSON.stringify({ buildContext: { isPreview: false, mode: 'production' } }, null, 2));
await writeFile(`${worker}/worker.config.json`, JSON.stringify({
  name,
  compatibilityDate: '2026-10-13',
  workersDev: false,
  previewUrls: false,
  domains: [hostname],
  env,
  ...(example === 'durable' ? { exports: { Counter: { type: 'durable-object', storage: 'sqlite' } } } : {}),  ...(example === 'core' ? { assets: { runWorkerFirst: true } } : {}),
  observability: { enabled: true, traces: { enabled: true } },
  manifest: {
    type: 'complete',
    mainModule: 'worker.mjs',
    modules: { 'worker.mjs': { type: 'esm' }, ...Object.fromEntries([...wasmModules.keys()].map(name => [name, { type: 'wasm' }])) },
  },
}, null, 2));
await writeFile(`${root}/test-deployment.json`, JSON.stringify({ name, hostname, root, example, bindingId, upstreamName }, null, 2));
console.log(JSON.stringify({ name, hostname, root, note: 'Built only; no resources deployed.' }, null, 2));
