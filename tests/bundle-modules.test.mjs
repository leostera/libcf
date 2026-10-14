import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Miniflare, Log, LogLevel } from 'miniflare';
const execute = promisify(execFile);

// The subprocess uses Bazel's pinned Node and declared bundler/esbuild inputs.
// No CLI/account/configuration discovery and no fabricated deployment manifest.
test('bundle schema2 declares actual text-module imports and requires a supplied module', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-bundle-modules-'));
  let runtime;
  try {
    const entry = join(root, 'entry.mjs'), output = join(root, 'bundle');
    const tool = fileURLToPath(new URL('../scripts/bundle-worker.mjs', import.meta.url));
    const bundle = () => execute(process.execPath, [tool, entry, output], { timeout: 10000 });
    await writeFile(entry, `import text from '__STATIC_CONTENT_MANIFEST';
      export default { fetch() { return Response.json(JSON.parse(text)); } };`);
    await bundle();
    const manifest = JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8'));
    assert.deepEqual(manifest, { schemaVersion: 2, mainModule: 'worker.mjs', wasmModules: [], requiredTextModules: ['__STATIC_CONTENT_MANIFEST'] });
    assert.deepEqual((await readdir(output)).sort(), ['bundle.json', 'worker.mjs']);
    const script = await readFile(join(output, 'worker.mjs'), 'utf8'); assert.match(script, /__STATIC_CONTENT_MANIFEST/);
    const start = supplied => new Miniflare({ host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), workers: [{ config: {
      name: 'module-contract', compatibilityDate: '2026-10-13',
      manifest: { mainModule: 'worker.mjs', modulesRoot: output, modules: {
        'worker.mjs': { type: 'esm', contents: script },
        ...(supplied ? { __STATIC_CONTENT_MANIFEST: { type: 'text', contents: '{"owned":"physical-key"}' } } : {}),
      } },
    } }] });
    runtime = start(false);
    let startupError;
    await assert.rejects(runtime.ready, error => {
      startupError = error;
      return error.code === 'ERR_RUNTIME_FAILURE' && /No such module.*__STATIC_CONTENT_MANIFEST/.test(error.message);
    });
    const failed = runtime; runtime = undefined;
    // This pinned Miniflare can replay its startup failure during disposal.
    await failed.dispose().catch(error => assert.equal(error, startupError));
    runtime = start(true);
    const response = await runtime.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { owned: 'physical-key' });
    await runtime.dispose(); runtime = undefined;
    await writeFile(entry, `if (false) import('__STATIC_CONTENT_MANIFEST');
      export default { fetch() { return new Response('no dependency'); } };`);
    await bundle();
    const without = JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8'));
    assert.equal(without.schemaVersion, 2); assert.deepEqual(without.requiredTextModules, []);
  } finally {
    try { await runtime?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
