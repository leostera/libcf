import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';

test('emitted C++ Sites bundle reads the native local manifest/namespace', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-sites-cpp-')); let runtime;
  try {
    const assets = join(root, 'assets'); await mkdir(assets);
    const text = await readFile(new URL('../public/index.txt', import.meta.url), 'utf8');
    const binary = new Uint8Array([0, 255, 128, 13, 10]);
    for (const [name, value] of [['index.txt', text], ['space 猫.bin', binary], ['empty', new Uint8Array()], ['maximum', new Uint8Array(1048576).fill(9)], ['oversized', new Uint8Array(1048577)], ['hidden', 'excluded']]) await writeFile(join(assets, name), value);
    const directory = 'bundles/legacy-sites';
    const inventory = JSON.parse(await readFile(`${directory}/bundle.json`, 'utf8'));
    assert.equal(inventory.schemaVersion, 2); assert.deepEqual(inventory.requiredTextModules, ['__STATIC_CONTENT_MANIFEST']); assert.equal(inventory.wasmModules.length, 1);
    const modules = { 'worker.mjs': { type: 'esm', contents: await readFile(`${directory}/worker.mjs`, 'utf8') } };
    for (const file of inventory.wasmModules) modules[file] = { type: 'wasm', contents: await readFile(`${directory}/${file}`) };
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{
      config: { name: 'sites-cpp', compatibilityDate: '2026-10-13', manifest: { mainModule: 'worker.mjs', modulesRoot: join(root, 'modules'), modules } },
      legacy: { sitePath: assets, siteExclude: ['hidden'] },
    }] });
    const get = (body = '', path = '/read') => runtime.dispatchFetch('https://example.test' + path, { method: 'POST', body, signal: AbortSignal.timeout(10000) });
    const health = await runtime.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(10000) }); assert.equal(health.status, 200); assert.match(await health.text(), /Legacy Sites read-only/);
    const first = await get(); assert.equal(first.status, 200); assert.equal(await first.text(), text); assert.equal(first.headers.get('content-type'), 'application/octet-stream'); assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    const unicode = await get('space 猫.bin'); assert.equal(unicode.status, 200); assert.deepEqual(new Uint8Array(await unicode.arrayBuffer()), binary);
    const empty = await get('empty'); assert.equal(empty.status, 200); assert.equal((await empty.arrayBuffer()).byteLength, 0);
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const response = await get(i % 2 ? 'space 猫.bin' : 'index.txt'); assert.equal(response.status, 200);
      if (i % 2) assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary); else assert.equal(await response.text(), text);
    }));
    const maximum = await get('maximum'); assert.equal(maximum.status, 200); const data = new Uint8Array(await maximum.arrayBuffer()); assert.equal(data.length, 1048576); assert(data.every(byte => byte === 9));
    for (const key of ['oversized', '../index.txt', '/index.txt', 'index.txt?x', 'space%20猫.bin', 'a\0b', 'x'.repeat(513)]) { const response = await get(key); assert.equal(response.status, 502); assert.equal(await response.text(), 'Sites read failed'); }
    for (const key of ['absent', 'hidden', '__proto__', 'constructor', 'x'.repeat(512)]) { const response = await get(key); assert.equal(response.status, 404); assert.equal(await response.text(), 'not found'); }
    const missing = await get('index.txt', '/missing-binding'); assert.equal(missing.status, 502); assert.equal(await missing.text(), 'Sites read failed');
    await unlink(join(assets, 'index.txt')); const stale = await get(); assert.equal(stale.status, 404); await stale.arrayBuffer();
    const recovery = await get('space 猫.bin'); assert.equal(recovery.status, 200); assert.deepEqual(new Uint8Array(await recovery.arrayBuffer()), binary);
    await runtime.dispose(); runtime = undefined;
    // Same emitted bundle, intentionally malformed supplied deployment text.
    // This is configuration rejection, not a native namespace test.
    const invalid = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
      name: 'invalid-sites-manifest', compatibilityDate: '2026-10-13',
      manifest: { mainModule: 'worker.mjs', modulesRoot: join(root, 'invalid-modules'), modules: {
        ...modules, __STATIC_CONTENT_MANIFEST: { type: 'text', contents: '{"../invalid":"hash"}' },
      } },
    } }] });
    let startupError;
    try {
      await assert.rejects(invalid.ready, error => {
        startupError = error;
        return error.code === 'ERR_RUNTIME_FAILURE' && /invalid Sites relative path/.test(error.message);
      });
    } finally { await invalid.dispose().catch(error => assert.equal(error, startupError)); }
  } finally {
    try { await runtime?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
