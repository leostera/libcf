import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const names = [
  'core', 'kv', 'd1', 'r2', 'cache', 'service', 'durable', 'events',
  'websocket', 'email', 'rate-limit', 'analytics', 'metadata', 'worker-loader',
  'crypto', 'benchmark', 'http-client', 'pipeline', 'timer', 'workflow',
  'images', 'clock', 'rpc', 'ai', 'service-tcp', 'hello', 'hello-js', 'benchmark-js',
  'service-upstream', 'http-upstream', 'rpc-reference', 'service-tcp-reference',
];
const plainJs = new Set(['hello-js', 'benchmark-js', 'service-upstream', 'http-upstream', 'rpc-reference', 'service-tcp-reference']);
const manifests = new Map();
for (const name of names) {
  const directory = `bundles/${name}`;
  const manifest = JSON.parse(await readFile(`${directory}/bundle.json`, 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['mainModule', 'schemaVersion', 'wasmModules']);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mainModule, 'worker.mjs');
  assert.equal(manifest.wasmModules.length, plainJs.has(name) ? 0 : name === 'durable' ? 2 : 1, name);
  assert.deepEqual(manifest.wasmModules, [...new Set(manifest.wasmModules)].sort());
  assert.deepEqual((await readdir(directory)).sort(), ['bundle.json', 'worker.mjs', ...manifest.wasmModules].sort());
  const javascript = await readFile(`${directory}/worker.mjs`, 'utf8');
  const modules = { 'worker.mjs': { type: 'esm', contents: javascript } };
  for (const file of manifest.wasmModules) {
    assert.match(file, /^[a-f0-9]{64}\.wasm$/);
    const bytes = await readFile(`${directory}/${file}`);
    assert.equal(file, `${createHash('sha256').update(bytes).digest('hex')}.wasm`);
    assert(WebAssembly.validate(bytes), `${name}: invalid Wasm`);
    assert(javascript.includes(`./${file}`), `${name}: missing static Wasm import`);
    modules[file] = { type: 'wasm', contents: bytes };
  }
  manifests.set(name, modules);
}

// Execute the emitted files, not source entry points rebundled in the test.
for (const name of ['benchmark', 'benchmark-js']) {
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name,
    compatibilityDate: '2026-10-13',
    env: {},
    exports: {},
    manifest: {
      mainModule: 'worker.mjs',
      modulesRoot: `/libcf-bundle-test/${name}`,
      modules: manifests.get(name),
    },
  } }] });
  try {
    const response = await runtime.dispatchFetch('https://example.test/hello', {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  } finally { await runtime.dispose(); }
}
console.log(`Verified ${names.length} bundle inventories; emitted C++ and JS bundles execute in workerd`);
