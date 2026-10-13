import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare } from 'miniflare';

async function workerOptions(configPath, root) {
  // Repository-owned fixtures intentionally use the JSON subset of JSONC.
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const directory = dirname(resolve(configPath));
  const moduleRoot = resolve(root, config.name);
  const wasm = [];
  const output = await build({
    entryPoints: [resolve(directory, config.main)],
    outfile: resolve(moduleRoot, 'worker.mjs'),
    bundle: true, write: false, format: 'esm', platform: 'browser',
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
    env: {
      ...Object.fromEntries(Object.entries(config.vars ?? {}).map(([name, value]) => [name, { type: 'text', value }])),
      ...Object.fromEntries((config.kv_namespaces ?? []).map(x => [x.binding, { type: 'kv', id: x.id }])),
      ...Object.fromEntries((config.d1_databases ?? []).map(x => [x.binding, { type: 'd1', id: x.database_id }])),
      ...Object.fromEntries((config.r2_buckets ?? []).map(x => [x.binding, { type: 'r2', name: x.bucket_name }])),
      ...Object.fromEntries((config.services ?? []).map(x => [x.binding, { type: 'worker', worker: x.service }])),
      ...(config.assets ? { [config.assets.binding]: { type: 'assets' } } : {}),
    },
    ...(config.assets ? { assets: { directory: resolve(directory, config.assets.directory), hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first } } : {}),
  } };
}

export async function startLocalWorker(config, readyPath = '/', additionalConfigs = []) {
  const root = await mkdtemp(resolve(tmpdir(), 'libcf-local-'));
  let runtime;
  async function dispose() {
    try { await runtime?.dispose(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
  try {
    const workers = await Promise.all([config, ...additionalConfigs].map(path => workerOptions(path, root)));
    // All bindings are local workerd resources; no CLI, credentials, persistent
    // state, or remote binding fallback is involved in the default test suite.
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers });
    const base = (await runtime.ready).origin;
    const ready = await fetch(`${base}${readyPath}`, { signal: AbortSignal.timeout(10000) });
    await ready.arrayBuffer();
    return { base, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
