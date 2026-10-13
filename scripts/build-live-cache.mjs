import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Build only: no network calls or implicit deployment. Each build receives an
// isolated name; all live URLs stay within the user-approved DNS namespace.
const name = `libcf-cache-${randomBytes(5).toString('hex')}`;
const hostname = `${name}.libcf.leostera.dev`;
const root = resolve('build/live-cache');
const output = `${root}/.cloudflare/output/v0`;
const worker = `${output}/workers/default`;
const bundle = `${worker}/bundle`;
await mkdir(bundle, { recursive: true });
await build({
  entryPoints: ['examples/cache/worker.mjs'],
  outfile: `${bundle}/worker.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [{
    name: 'precompiled-wasm',
    setup(builder) {
      builder.onResolve({ filter: /cache\.wasm$/ }, () => ({ path: './cache.wasm', external: true }));
    },
  }],
});
await copyFile('build/cache.wasm', `${bundle}/cache.wasm`);
await writeFile(`${output}/config.json`, JSON.stringify({ buildContext: { isPreview: false, mode: 'production' } }, null, 2));
await writeFile(`${worker}/worker.config.json`, JSON.stringify({
  name,
  compatibilityDate: '2026-10-13',
  workersDev: false,
  previewUrls: false,
  domains: [hostname],
  observability: { enabled: true, traces: { enabled: true } },
  manifest: {
    type: 'complete',
    mainModule: 'worker.mjs',
    modules: { 'worker.mjs': { type: 'esm' }, 'cache.wasm': { type: 'wasm' } },
  },
}, null, 2));
await writeFile(`${root}/test-deployment.json`, JSON.stringify({ name, hostname, root }, null, 2));
console.log(JSON.stringify({ name, hostname, root, note: 'Built only; no resources deployed.' }, null, 2));
