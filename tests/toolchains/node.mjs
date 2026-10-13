import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { parse } from 'jsonc-parser';
import { Miniflare } from 'miniflare';

assert.equal(process.versions.node, '26.11.1');
assert.deepEqual(parse('{/* fixture */ "answer": 42}'), { answer: 42 });
const compiled = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    import createModule from './build/spike.mjs';
    import compiledWasm from './build/spike.wasm';
    const module = createModule({ instantiateWasm(imports, receiveInstance) {
      const instance = new WebAssembly.Instance(compiledWasm, imports);
      receiveInstance(instance);
      return instance.exports;
    } });
    export default { async fetch() {
      return new Response(String((await module)._cf_add(19, 23)));
    } };
  ` },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  external: ['*.wasm'],
});
const runtime = new Miniflare({
  host: '127.0.0.1',
  port: 0,
  workers: [{ config: {
    name: 'toolchain-smoke',
    compatibilityDate: '2026-10-13',
    env: {},
    exports: {},
    manifest: {
      mainModule: 'worker.mjs',
      modulesRoot: '/libcf-toolchain-smoke',
      modules: {
        'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text },
        'build/spike.wasm': { type: 'wasm', contents: await readFile('build/spike.wasm') },
      },
    },
  } }],
});
try {
  const response = await runtime.dispatchFetch('https://example.test/', {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '42');
} finally {
  await runtime.dispose();
}
console.log(`Bazel Node toolchain: ${process.version} (${process.platform}/${process.arch}); esbuild/workerd passed`);
