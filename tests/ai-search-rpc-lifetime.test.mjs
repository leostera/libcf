import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Native RPC ownership evidence only: this service is not the AI Search provider.
test('keyword projection releases native RPC capabilities on success, invalid result, abort and deadline', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performAiSearch } from './lib/ai-search.mjs';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname.slice(1);
      const controller = new AbortController();
      let retained, nativeFailure, drain;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { search(params) {
        const native = env.REFERENCE.search(params);
        const observed = Promise.resolve(native).then(value => {
          retained = value; drain(); return value;
        }, error => { nativeFailure = error.message; drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose]();
        return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, byteCount;
      const operation = performAiSearch(binding, '', new TextEncoder().encode(path),
        path === 'timeout' ? '1:5' : '1:5000', controller.signal);
      if (path === 'abort') setTimeout(() => controller.abort(), 10);
      try { byteCount = (await operation).bytes.length; }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained;
      // Drain continuation runs before the projection/disposal continuation.
      await new Promise(resolve => setTimeout(resolve, 0));
      let afterDispose;
      if (retained) {
        try { await retained.chunks[0].item.metadata.target.ping(); afterDispose = 'unexpected success'; }
        catch (failure) { afterDispose = failure.message; }
      }
      const alive = await env.REFERENCE.alive();
      return Response.json({ error, byteCount, afterDispose, nativeFailure, delivered: !!retained, alive });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-search-rpc/${name}`,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 'alive'; } }
      export class Reference extends WorkerEntrypoint {
        alive() { return 'borrowed service alive'; }
        async search(params) {
          if (['timeout', 'abort'].includes(params.query)) await new Promise(resolve => setTimeout(resolve, 100));
          return { chunks: [{ id: 'owned', type: 'text', score: params.query === 'bad' ? 2 : 0.5,
            text: 'projected text', item: { key: 'doc.txt', metadata: { date: new Date(0), target: new Target() } } }] };
        }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'abort', 'timeout']) {
      const response = await mf.dispatchFetch(`https://example.test/${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      if (result.delivered) assert.match(result.afterDispose, /disposed/i);
      else assert.equal(typeof result.nativeFailure, 'string');
      if (path === 'success') { assert.equal(result.error, undefined); assert(result.byteCount > 4); assert(result.delivered); }
      if (path === 'bad') { assert.equal(result.error.name, 'TypeError'); assert(result.delivered); }
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
      if (path === 'timeout') assert.equal(result.error.name, 'TimeoutError');
    }
  } finally { await mf.dispose(); }
});
