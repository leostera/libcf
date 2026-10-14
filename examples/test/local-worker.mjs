import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare } from 'miniflare';
import { parseFixtureConfig } from './jsonc.mjs';

async function workerOptions(configPath, root) {
  const config = parseFixtureConfig(await readFile(configPath, 'utf8'));
  if (Object.hasOwn(config, 'containers') || Object.values(config.exports ?? {}).some(
    value => value && typeof value === 'object' && Object.hasOwn(value, 'container')))
    throw new Error('Containers require an explicit local engine/image and cleanup plan; use a separate approved harness');
  if (Object.hasOwn(config, 'artifacts'))
    throw new Error('Artifacts uses a remote service; use an explicit local mock configuration');
  const flagship = {};
  if (Object.hasOwn(config, 'flagship')) {
    const invalid = () => { throw new Error('Flagship requires explicit local seeding, remote:false, unique binding names and valid app IDs'); };
    if (!Array.isArray(config.flagship) || config.flagship.length === 0) invalid();
    for (const item of config.flagship) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.remote !== false ||
          typeof item.binding !== 'string' || /^[A-Za-z][A-Za-z0-9_]{0,63}$/.exec(item.binding)?.[0] !== item.binding ||
          typeof item.app_id !== 'string' || /^[A-Za-z0-9_-]{1,128}$/.exec(item.app_id)?.[0] !== item.app_id ||
          Object.keys(item).some(key => !['binding', 'app_id', 'remote'].includes(key)) ||
          Object.hasOwn(flagship, item.binding)) invalid();
      flagship[item.binding] = { type: 'flagship', id: item.app_id, dev: { remote: false } };
    }
  }
  if (config.ai) throw new Error('Workers AI is remote inference; use an explicit local mock configuration');
  if (config.vectorize) throw new Error('Vectorize requires a remote index; use an explicit local mock configuration');
  if (config.dispatch_namespaces) throw new Error('Dispatch namespaces require remote Workers for Platforms; use an explicit local mock configuration');
  if (config.media) throw new Error('Media Transformations use a remote service; use an explicit local mock configuration');
  if (config.browser) throw new Error('Browser Run requires an explicit local mock here; native sessions need a declared browser toolchain');
  if (config.ai_search || config.ai_search_namespaces || config.agent_memory)
    throw new Error('AI Search and Agent Memory use remote services; use an explicit local mock configuration');
  if (config.stream?.remote !== undefined && config.stream.remote !== false)
    throw new Error('Remote Stream is not allowed in local tests; use the local simulator configuration');
  const directory = dirname(resolve(configPath));
  const moduleRoot = resolve(root, config.name);
  const wasm = [];
  const output = await build({
    entryPoints: [resolve(directory, config.main)],
    outfile: resolve(moduleRoot, 'worker.mjs'),
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'],
    plugins: [{
      name: 'wasm-modules',
      setup(builder) {
        builder.onResolve({ filter: /\.wasm$/ }, async args => {
          const name = `${wasm.length}-${basename(args.path)}`;
          wasm.push({ type: 'CompiledWasm', path: resolve(moduleRoot, name), contents: await readFile(resolve(args.resolveDir, args.path)) });
          return { path: `./${name}`, external: true };
        });
      },
    }],
  });
  return { config: {
    name: config.name,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    manifest: {
      mainModule: 'worker.mjs', modulesRoot: moduleRoot,
      modules: {
        'worker.mjs': { type: 'esm', contents: output.outputFiles[0].text },
        ...Object.fromEntries(wasm.map(x => [basename(x.path), { type: 'wasm', contents: x.contents }])),
      },
    },
    triggers: [
      ...(config.triggers?.crons ?? []).map(schedule => ({ type: 'scheduled', schedule })),
      ...(config.queues?.consumers ?? []).map(queue => ({ type: 'queue', name: queue.queue,
        maxBatchSize: queue.max_batch_size, maxBatchTimeout: queue.max_batch_timeout,
        maxRetries: queue.max_retries, retryDelay: queue.retry_delay,
      })),
    ],
    exports: {
      ...Object.fromEntries((config.migrations ?? []).flatMap(migration =>
        (migration.new_sqlite_classes ?? []).map(name => [name, { type: 'durable-object', storage: 'sqlite' }]))),
      ...Object.fromEntries((config.workflows ?? []).map(x => [x.class_name, { type: 'workflow', name: x.name }])),
    },
    env: {
      ...flagship,
      ...(config.images ? { [config.images.binding]: { type: 'images' } } : {}),
      ...(config.stream ? { [config.stream.binding]: { type: 'stream' } } : {}),
      ...Object.fromEntries((config.workflows ?? []).map(x => [x.binding, {
        type: 'workflow', name: x.name, worker: config.name, exportName: x.class_name,
      }])),
      ...Object.fromEntries((config.pipelines ?? []).map(x => [x.binding, { type: 'pipeline', name: x.pipeline }])),
      ...Object.fromEntries((config.worker_loaders ?? []).map(x => [x.binding, { type: 'worker-loader' }])),
      ...(config.version_metadata ? { [config.version_metadata.binding]: { type: 'version-metadata' } } : {}),
      ...Object.fromEntries((config.secrets_store_secrets ?? []).map(x => [x.binding, {
        type: 'secrets-store-secret', storeId: x.store_id, secretName: x.secret_name,
      }])),
      ...Object.fromEntries(Object.entries(config.vars ?? {}).map(([name, value]) => [name, { type: 'text', value }])),
      ...Object.fromEntries((config.kv_namespaces ?? []).map(x => [x.binding, { type: 'kv', id: x.id }])),
      ...Object.fromEntries((config.d1_databases ?? []).map(x => [x.binding, { type: 'd1', id: x.database_id }])),
      ...Object.fromEntries((config.analytics_engine_datasets ?? []).map(x => [x.binding, { type: 'analytics-engine-dataset', name: x.dataset }])),
      ...Object.fromEntries((config.ratelimits ?? []).map(x => [x.name, { type: 'rate-limit', namespace: x.namespace_id, simple: x.simple }])),
      ...Object.fromEntries((config.queues?.producers ?? []).map(x => [x.binding, { type: 'queue', name: x.queue }])),
      ...Object.fromEntries((config.r2_buckets ?? []).map(x => [x.binding, { type: 'r2', name: x.bucket_name }])),
      ...Object.fromEntries((config.services ?? []).map(x => [x.binding, { type: 'worker', worker: x.service }])),
      ...Object.fromEntries((config.durable_objects?.bindings ?? []).map(x =>
        [x.name, { type: 'durable-object', worker: x.script_name ?? config.name, exportName: x.class_name }])),
      ...(config.assets ? { [config.assets.binding]: { type: 'assets' } } : {}),
    },
    ...(config.assets ? { assets: { directory: resolve(directory, config.assets.directory), hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first } } : {}),
  } };
}

export async function startLocalWorker(config, { readyPath = '/', additionalConfigs = [], persistencePath, triggerHandlers = false } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'libcf-local-'));
  let runtime;
  async function dispose() {
    try { await runtime?.dispose(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
  try {
    const workers = await Promise.all([config, ...additionalConfigs].map(path => workerOptions(path, root)));
    // All bindings are local workerd resources; no CLI, credentials or remote
    // binding fallback. Restart tests may opt into caller-owned temporary state.
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers, unsafeTriggerHandlers: triggerHandlers,
      ...(persistencePath ? { resourcePersistencePath: persistencePath } : {}),
    });
    const base = (await runtime.ready).origin;
    const ready = await fetch(`${base}${readyPath}`, { signal: AbortSignal.timeout(10000) });
    await ready.arrayBuffer();
    return { base, dispose,
      scheduled: async options => (await runtime.getWorker()).scheduled(options),
      queue: async (name, messages) => (await runtime.getWorker()).queue(name, messages),
      durableStub: async (binding, name) => (await runtime.getBindings())[binding].getByName(name),
      secretAdmin: async binding => (await runtime.getSecretsStoreSecretAPI(binding))(),
      evictDurable: (className, options) => runtime.unsafeEvictDurableObject(workers[0].config.name, className, options),
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
