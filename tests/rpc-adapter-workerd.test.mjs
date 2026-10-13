import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('real service RPC encodes JSON and releases rejected/late native capability results', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performRpc } from './lib/rpc.mjs';
    const input = new TextEncoder().encode('[]');
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === '/echo') {
        const result = await performRpc(304, env.REFERENCE, 'echo',
          new TextEncoder().encode('[{"nested":[null,true,"owned"]}]'), '');
        return new Response(result.bytes);
      }
      let retained;
      const abort = new AbortController();
      const binding = { invoke() {
        const native = path === '/abort' ? env.REFERENCE.slow() : env.REFERENCE.capability();
        const observed = Promise.resolve(native).then(value => { retained = value; return value; });
        observed[Symbol.dispose] = () => native[Symbol.dispose]();
        return observed;
      }};
      let error;
      const operation = performRpc(304, binding, 'invoke', input, '', abort.signal);
      if (path === '/abort') {
        await new Promise(resolve => setTimeout(resolve, 10));
        abort.abort();
      }
      try { await operation; } catch (failure) { error = { name: failure.name, message: failure.message }; }
      let afterDispose;
      try { await retained.target.ping(); afterDispose = 'unexpected success'; }
      catch (failure) { afterDispose = failure.message; }
      return Response.json({ error, afterDispose });
    }};
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-rpc-adapter/${name}`,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 42; } }
      export class Reference extends WorkerEntrypoint {
        echo(value) { return value; }
        capability() { return { target: new Target() }; }
        async slow() { await new Promise(resolve => setTimeout(resolve, 100)); return this.capability(); }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['/echo', '/capability', '/abort']) {
      const response = await mf.dispatchFetch(`https://example.test${path}`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      const value = await response.json();
      if (path === '/echo') assert.deepEqual(value, { nested: [null, true, 'owned'] });
      else {
        assert.match(value.afterDispose, /disposed/i);
        if (path === '/abort') assert.equal(value.error.name, 'AbortError');
        else assert.match(value.error.message, /unsupported JSON output/);
      }
    }
  } finally { await mf.dispose(); }
});
