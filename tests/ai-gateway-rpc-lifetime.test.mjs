import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Real service RPC with fake gateways. No AI binding, backend discovery or inference.
test('Gateway URL lookup owns RPC gateway/read roots, including failed/canceled paths', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performAiGatewayUrl as perform } from './lib/ai-gateway.mjs';
    export default { async fetch(request, env) {
      const id = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let root, drain;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { gateway(id) {
        const native = env.REFERENCE.gateway(id);
        const observed = Promise.resolve(native).then(value => { root = value; drain(); return value; }, error => { drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose](); return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, url;
      const pending = perform(binding, id, new TextEncoder().encode('openai'), id.startsWith('slow-') ? '20' : '5000', controller.signal);
      if (id === 'abort') setTimeout(() => controller.abort(), 10);
      try { url = new TextDecoder().decode((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained; await new Promise(resolve => setTimeout(resolve, 0));
      let rootAfter;
      if (root) { try { rootAfter = await root.ping(); } catch (error) { rootAfter = error.message; } }
      return Response.json({ error, url, rootAfter, alive: await env.REFERENCE.alive(), reads: await env.REFERENCE.reads(id) });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-ai-gateway-rpc/' + name,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      const counts = new Map();
      class Gateway extends RpcTarget {
        #id;
        constructor(id) { super(); this.#id = id; }
        ping() { return 'unexpected alive'; }
        async getUrl(...args) {
          if (args.length !== 1 || args[0] !== 'openai') throw new Error('unexpected arguments');
          const id = this.#id; counts.set(id, (counts.get(id) ?? 0) + 1);
          if (id === 'slow-read' || id === 'abort') await new Promise(resolve => setTimeout(resolve, 100));
          if (id === 'throw') throw new Error('lookup failed');
          return id === 'bad' ? 'https://example.test/' : 'https://gateway.ai.cloudflare.com/v1/synthetic-account/' + id + '/openai';
        }
      }
      export class Reference extends WorkerEntrypoint {
        async gateway(id) {
          if (id === 'slow-acquire') await new Promise(resolve => setTimeout(resolve, 100));
          return new Gateway(id);
        }
        alive() { return 'borrowed service alive'; }
        reads(id) { return counts.get(id) ?? 0; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const id of ['owned', 'bad', 'throw', 'slow-acquire', 'slow-read', 'abort']) {
      const response = await mf.dispatchFetch('https://example.test/' + id, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      assert.equal(result.reads, id === 'slow-acquire' ? 0 : 1);
      if (id !== 'slow-acquire' || result.rootAfter) assert.match(result.rootAfter, /disposed/i);
      if (id === 'owned') { assert.equal(result.error, undefined); assert.equal(result.url, 'https://gateway.ai.cloudflare.com/v1/synthetic-account/owned/openai'); }
      if (id === 'bad') assert.match(result.error.message, /AI Gateway URL/);
      if (id === 'throw') assert.match(result.error.message, /lookup failed/);
      if (id.startsWith('slow-')) assert.equal(result.error.name, 'TimeoutError');
      if (id === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});
