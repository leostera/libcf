import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Real workerd service RPC with fake metadata, never a Container/engine binding.
test('Container inspection projects RPC metadata before releasing roots and drains canceled reads', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performContainerInspect as perform } from './lib/container.mjs';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let root, drain, nativeFailure;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { inspect() {
        const native = env.REFERENCE.inspect(path);
        const observed = Promise.resolve(native).then(value => { root = value; drain(); return value; },
          error => { nativeFailure = error.message; drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose]();
        return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed container disposed'); } };
      let error, bytes;
      const pending = perform(binding, '', new Uint8Array(), path === 'timeout' ? '20' : '5000', controller.signal);
      if (path === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained;
      await new Promise(resolve => setTimeout(resolve, 0));
      let rootAfter;
      if (root?.unused) { try { rootAfter = await root.unused.ping(); } catch (error) { rootAfter = error.message; } }
      return Response.json({ error, bytes, nativeFailure, rootAfter, alive: await env.REFERENCE.alive() });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-container-rpc/${name}`,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 'unexpected alive'; } }
      export class Reference extends WorkerEntrypoint {
        async inspect(mode) {
          if (['timeout', 'abort'].includes(mode)) await new Promise(resolve => setTimeout(resolve, 100));
          if (mode === 'null') return null;
          return { image: mode === 'bad' ? 1 : '', labels: { owner: 'libcf' }, unused: new Target() };
        }
        alive() { return 'borrowed service alive'; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'null', 'bad', 'timeout', 'abort']) {
      const response = await mf.dispatchFetch(`https://example.test/${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      if (result.rootAfter) assert.match(result.rootAfter, /disposed/i);
      if (path === 'success') {
        assert.equal(result.error, undefined); assert.match(result.rootAfter, /disposed/i);
        assert.deepEqual(result.bytes, [1,0,0,0, 0,0,0,0, 1,0,0,0, 5,0,0,0, 111,119,110,101,114, 5,0,0,0, 108,105,98,99,102]);
      }
      if (path === 'null') { assert.equal(result.error, undefined); assert.deepEqual(result.bytes, [0,0,0,0]); }
      if (path === 'bad') assert.match(result.error.message, /invalid Container inspection text/);
      if (path === 'timeout') assert.equal(result.error.name, 'TimeoutError');
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});
