import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Actual RPC capabilities/Dates, explicit fake memory service. No Agent Memory binding.
test('memory projection retains scoped RPC roots, handles Dates and releases late profiles without reading', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performAgentMemoryListCreatingProfile as perform } from './lib/agent-memory.mjs';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let scope, root, drain, nativeFailure;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { getProfile(name) {
        const native = env.REFERENCE.getProfile(name);
        const acquisition = Promise.resolve(native).then(value => {
          scope = value;
          if (path === 'acquire-timeout') drain();
          return { list(options) {
            const read = scope.list(options);
            const observed = Promise.resolve(read).then(value => { root = value; drain(); return value; },
              error => { nativeFailure = error.message; drain(); throw error; });
            observed[Symbol.dispose] = () => read[Symbol.dispose]();
            return observed;
          }, [Symbol.dispose]() { scope[Symbol.dispose](); } };
        }, error => { nativeFailure = error.message; drain(); throw error; });
        acquisition[Symbol.dispose] = () => native[Symbol.dispose]();
        return acquisition;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, bytes;
      const pending = perform(binding, path, new Uint8Array(), path.includes('timeout') ? '1:20' : '1:5000', controller.signal);
      if (path === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained;
      await new Promise(resolve => setTimeout(resolve, 0));
      const ping = async target => { try { return await target.ping(); } catch (error) { return error.message; } };
      return Response.json({ error, bytes, nativeFailure,
        scopeAfter: scope ? await ping(scope) : undefined,
        rootAfter: root ? await ping(root.memories[0].content) : undefined,
        reads: await env.REFERENCE.reads(path), alive: await env.REFERENCE.alive() });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-memory-rpc/${name}`,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      const reads = new Map(); // Owned fixture instrumentation only.
      class Target extends RpcTarget { ping() { return 'unexpected alive'; } }
      class Profile extends RpcTarget {
        constructor(name) { super(); this.name = name; }
        ping() { return 'unexpected alive'; }
        async list(options) {
          reads.set(this.name, (reads.get(this.name) ?? 0) + 1);
          if (options.limit !== 1 || Object.keys(options).length !== 1) throw new Error('unexpected list options');
          if (['read-timeout', 'abort'].includes(this.name)) await new Promise(resolve => setTimeout(resolve, 100));
          return { memories: [{ id: 'owned', type: 'event', summary: 'projected', sessionId: null,
            createdAt: this.name === 'bad' ? 'not a Date' : new Date(-1), updatedAt: new Date(1),
            content: new Target() }] };
        }
      }
      export class Reference extends WorkerEntrypoint {
        async getProfile(name) {
          if (name === 'acquire-timeout') await new Promise(resolve => setTimeout(resolve, 100));
          return new Profile(name);
        }
        reads(name) { return reads.get(name) ?? 0; }
        alive() { return 'borrowed service alive'; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'acquire-timeout', 'read-timeout', 'abort']) {
      const response = await mf.dispatchFetch(`https://example.test/${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      if (result.scopeAfter) assert.match(result.scopeAfter, /disposed/i);
      if (result.rootAfter) assert.match(result.rootAfter, /disposed/i);
      if (path === 'success') {
        assert.equal(result.error, undefined); assert(result.bytes.length > 32); assert.equal(result.reads, 1);
        assert.match(result.scopeAfter, /disposed/i); assert.match(result.rootAfter, /disposed/i);
        const bytes = Uint8Array.from(result.bytes), view = new DataView(bytes.buffer);
        assert.equal(view.getBigInt64(bytes.length - 16, true), -1n);
        assert.equal(view.getBigInt64(bytes.length - 8, true), 1n);
      }
      if (path === 'bad') assert.match(result.error.message, /invalid Agent Memory date/);
      if (path === 'acquire-timeout') assert.equal(result.reads, 0);
      if (path.includes('timeout')) assert.equal(result.error.name, 'TimeoutError');
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});
