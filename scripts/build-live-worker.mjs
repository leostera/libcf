import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Build only: no network calls or implicit deployment. Each build receives an
// isolated name; all live URLs stay within the user-approved DNS namespace.
const example = process.argv[2];
const bindingId = process.argv[3];
if (!['cache', 'd1', 'kv', 'r2'].includes(example)) throw new Error('Choose cache, d1, kv or r2');
if (example === 'd1' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bindingId ?? ''))
  throw new Error('D1 requires the UUID of an isolated test database');
if (example === 'kv' && !/^[a-f0-9]{32}$/.test(bindingId ?? ''))
  throw new Error('KV requires the ID of an isolated test namespace');
if (example === 'r2' && !/^libcf-r2-[a-f0-9]{10}$/.test(bindingId ?? ''))
  throw new Error('R2 requires an isolated libcf test bucket name');
if (example === 'cache' && bindingId) throw new Error('Cache requires no resource binding');
const env = {
  cache: {},
  d1: { DB: { type: 'd1', id: bindingId } },
  kv: { DEMO_KV: { type: 'kv', id: bindingId } },
  r2: { BUCKET: { type: 'r2', name: bindingId } },
}[example];
const name = `libcf-${example}-${randomBytes(5).toString('hex')}`;
const hostname = `${name}.libcf.leostera.dev`;
const root = resolve(`build/live-${example}`);
const output = `${root}/.cloudflare/output/v0`;
const worker = `${output}/workers/default`;
const bundle = `${worker}/bundle`;
await mkdir(bundle, { recursive: true });
await build({
  entryPoints: [`examples/${example}/worker.mjs`],
  outfile: `${bundle}/worker.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [{
    name: 'precompiled-wasm',
    setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, () => ({ path: './worker.wasm', external: true }));
    },
  }],
});
await copyFile(`build/${example}.wasm`, `${bundle}/worker.wasm`);
await writeFile(`${output}/config.json`, JSON.stringify({ buildContext: { isPreview: false, mode: 'production' } }, null, 2));
await writeFile(`${worker}/worker.config.json`, JSON.stringify({
  name,
  compatibilityDate: '2026-10-13',
  workersDev: false,
  previewUrls: false,
  domains: [hostname],
  env,
  observability: { enabled: true, traces: { enabled: true } },
  manifest: {
    type: 'complete',
    mainModule: 'worker.mjs',
    modules: { 'worker.mjs': { type: 'esm' }, 'worker.wasm': { type: 'wasm' } },
  },
}, null, 2));
await writeFile(`${root}/test-deployment.json`, JSON.stringify({ name, hostname, root, example, bindingId }, null, 2));
console.log(JSON.stringify({ name, hostname, root, note: 'Built only; no resources deployed.' }, null, 2));
