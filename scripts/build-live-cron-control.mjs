import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const databaseId = process.argv[2];
if (process.argv.length !== 3 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId ?? ''))
  throw new Error('Provide an isolated D1 database UUID');
const root = resolve('build/live-cron-control');
const output = `${root}/.cloudflare/output/v0`;
const suffix = randomBytes(5).toString('hex');
const workers = [];
for (const kind of ['js', 'cpp']) {
  const name = `libcf-cron-${kind}-${suffix}`;
  const directory = `${output}/workers/${kind === 'js' ? 'default' : 'cpp'}`;
  await mkdir(`${directory}/bundle`, { recursive: true });
  await build({
    entryPoints: [kind === 'js' ? 'examples/events/cron-control.mjs' : 'examples/events/worker.mjs'],
    outfile: `${directory}/bundle/worker.mjs`, bundle: true, format: 'esm', platform: 'browser',
    external: ['cloudflare:*'],
    plugins: [{ name: 'wasm', setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, args => {
        if (resolve(args.resolveDir, args.path) !== resolve('build/events.wasm')) throw new Error('Unexpected Wasm import');
        return { path: './events.wasm', external: true };
      });
    } }],
  });
  if (kind === 'cpp') await copyFile('build/events.wasm', `${directory}/bundle/events.wasm`);
  await writeFile(`${directory}/worker.config.json`, JSON.stringify({
    name, compatibilityDate: '2026-10-13', workersDev: false, previewUrls: false, domains: [],
    env: { DB: { type: 'd1', id: databaseId } },
    triggers: [{ type: 'scheduled', schedule: '* * * * *' }],
    observability: { enabled: true, traces: { enabled: true } },
    manifest: { type: 'complete', mainModule: 'worker.mjs', modules: {
      'worker.mjs': { type: 'esm' }, ...(kind === 'cpp' ? { 'events.wasm': { type: 'wasm' } } : {}),
    } },
  }, null, 2));
  workers.push({ name, kind });
}
await writeFile(`${output}/config.json`, JSON.stringify({ buildContext: { isPreview: false, mode: 'production' } }));
await writeFile(`${root}/test-deployment.json`, JSON.stringify({ root, databaseId, workers }, null, 2));
console.log(JSON.stringify({ root, workers, note: 'Build only. Internal-only Workers; no HTTP domains.' }, null, 2));
