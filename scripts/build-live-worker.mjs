import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdir, copyFile, writeFile, cp } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createLiveOutput } from './live-output.mjs';

// Build only: no network calls or implicit deployment. Each build receives an
// isolated name; all live URLs stay within the user-approved DNS namespace.
const example = process.argv[2];
const bindingId = process.argv[3];
const queueName = process.argv[4];
if (process.argv.length > 5 || (example !== 'events' && queueName !== undefined)) throw new Error('Unexpected build arguments');
if (!['cache', 'd1', 'kv', 'r2', 'core', 'service', 'durable', 'events', 'websocket', 'rate-limit', 'metadata', 'crypto', 'timer', 'images', 'http-client', 'workflow', 'clock', 'rpc'].includes(example))
  throw new Error('Choose cache, d1, kv, r2, core, service, durable, events, websocket, rate-limit, metadata, crypto, timer, images, http-client, workflow, clock or rpc');
if (['d1', 'events'].includes(example) && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bindingId ?? ''))
  throw new Error('D1 requires the UUID of an isolated test database');
if (['kv', 'core'].includes(example) && !/^[a-f0-9]{32}$/.test(bindingId ?? ''))
  throw new Error('KV requires the ID of an isolated test namespace');
if (example === 'r2' && !/^libcf-r2-[a-f0-9]{10}$/.test(bindingId ?? ''))
  throw new Error('R2 requires an isolated libcf test bucket name');
if (['cache', 'service', 'durable', 'websocket', 'rate-limit', 'metadata', 'crypto', 'timer', 'images', 'http-client', 'workflow', 'clock', 'rpc'].includes(example) && bindingId !== undefined) throw new Error('No resource binding ID is required');
if (example === 'events' && !/^libcf-events-[a-f0-9]{10}$/.test(queueName ?? ''))
  throw new Error('Events requires an isolated libcf test queue name');
const name = `libcf-${example}-${randomBytes(5).toString('hex')}`;
const upstreamName = ['service', 'rpc'].includes(example) ? `${name}-upstream`
  : example === 'http-client' ? name.replace('http-client', 'http-upstream') : undefined;
const upstreamHostname = example === 'http-client' ? `${upstreamName}.libcf.leostera.dev` : undefined;
const workflowName = example === 'workflow' ? name : undefined;
// Numeric namespaces are caller-defined, not separately provisioned objects.
// Use fresh safe-integer IDs plus probe-specific keys, never local fixture IDs.
const rateBase = 7000000000000000n + BigInt(`0x${randomBytes(6).toString('hex')}`);
const rateNamespaces = example === 'rate-limit' ? [String(rateBase), String(rateBase + 1n)] : undefined;
const env = {
  cache: {},
  crypto: {},
  timer: {},
  clock: {},
  rpc: { REFERENCE: { type: 'worker', worker: upstreamName } },
  workflow: { FLOW: { type: 'workflow', name: workflowName, worker: name, exportName: 'FixtureWorkflow' } },
  images: { IMAGES: { type: 'images' } },
  'http-client': { UPSTREAM_URL: { type: 'text', value: `https://${upstreamHostname}` } },
  metadata: { VERSION: { type: 'version-metadata' } }, // No live secret binding.
  'rate-limit': {
    LIMITER: { type: 'rate-limit', namespace: rateNamespaces?.[0], simple: { limit: 2, period: 10 } },
    OTHER: { type: 'rate-limit', namespace: rateNamespaces?.[1], simple: { limit: 2, period: 10 } },
  },
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
  websocket: { ROOMS: { type: 'durable-object', worker: name, exportName: 'Room' } },
  events: { DB: { type: 'd1', id: bindingId }, EVENTS: { type: 'queue', name: queueName } },
}[example];
const hostname = `${name}.libcf.leostera.dev`;
const root = await createLiveOutput(example);
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
  if (example === 'http-client') {
    await build({ entryPoints: ['examples/http-client/upstream/worker.mjs'],
      outfile: `${upstream}/bundle/worker.mjs`, bundle: true, format: 'esm', platform: 'browser' });
  } else await copyFile(example === 'rpc' ? 'examples/rpc/reference/worker.mjs' : 'examples/service/upstream/worker.mjs', `${upstream}/bundle/worker.mjs`);
  await writeFile(`${upstream}/worker.config.json`, JSON.stringify({
    name: upstreamName,
    compatibilityDate: '2026-10-13',
    workersDev: false,
    previewUrls: false,
    domains: upstreamHostname ? [upstreamHostname] : [],
    ...(example === 'rpc' ? { exports: { default: { type: 'worker' } } } : {}),
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
  ...(example === 'http-client' ? { compatibilityFlags: ['global_fetch_strictly_public'] } : {}),
  env,
  ...(example === 'durable' ? { exports: { Counter: { type: 'durable-object', storage: 'sqlite' } } } : {}),
  ...(example === 'websocket' ? { exports: { Room: { type: 'durable-object', storage: 'sqlite' } } } : {}),
  ...(example === 'workflow'
    ? { exports: { FixtureWorkflow: { type: 'workflow', name: workflowName } } }
    : {}),
  ...(example === 'core' ? { assets: { runWorkerFirst: true } } : {}),
  ...(example === 'events' ? { triggers: [
    { type: 'scheduled', schedule: '* * * * *' },
    { type: 'queue', name: queueName, maxBatchSize: 1, maxBatchTimeout: 1, maxRetries: 3, retryDelay: 1 },
  ] } : {}),
  observability: { enabled: true, traces: { enabled: true } },
  manifest: {
    type: 'complete',
    mainModule: 'worker.mjs',
    modules: { 'worker.mjs': { type: 'esm' }, ...Object.fromEntries([...wasmModules.keys()].map(name => [name, { type: 'wasm' }])) },
  },
}, null, 2));
await writeFile(`${root}/test-deployment.json`, JSON.stringify({ name, hostname, root, example, bindingId, upstreamName, upstreamHostname, workflowName, queueName, rateNamespaces }, null, 2));
console.log(JSON.stringify({ name, hostname, root, note: 'Built only; no resources deployed.' }, null, 2));
