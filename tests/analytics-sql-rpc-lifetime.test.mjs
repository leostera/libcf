import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Native service RPC, fake query engine. Never an Analytics SQL binding/account query.
test('Analytics SQL owns RPC rows through scalar projection and releases canceled results', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performAnalyticsSql as perform } from './lib/analytics-sql.mjs';
    export default { async fetch(request, env) {
      const mode = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let root, drain;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { query(request) {
        const native = env.REFERENCE.query(request);
        const observed = Promise.resolve(native).then(value => { root = value; drain(); return value; }, error => { drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose](); return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, bytes;
      const pending = perform(binding, 'SELECT value FROM synthetic WHERE timestamp >= $start LIMIT 1',
        new TextEncoder().encode(JSON.stringify({ start: 'synthetic-time', mode, ['__proto__']: 'safe', constructor: 'safe' })), mode === 'timeout' ? '1:20' : '1:5000', controller.signal);
      if (mode === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained; await new Promise(resolve => setTimeout(resolve, 0));
      let rootAfter;
      if (root?.unused) { try { rootAfter = await root.unused.ping(); } catch (error) { rootAfter = error.message; } }
      return Response.json({ error, bytes, rootAfter, alive: await env.REFERENCE.alive() });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-analytics-sql-rpc/' + name,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 'unexpected alive'; } }
      export class Reference extends WorkerEntrypoint {
        async query(request) {
          if (Object.keys(request).join(',') !== 'query,params' || request.params.start !== 'synthetic-time' ||
              !Object.hasOwn(request.params, '__proto__') || request.params.__proto__ !== 'safe' || request.params.constructor !== 'safe') throw new Error('unexpected request');
          const mode = request.params.mode;
          if (['timeout', 'abort'].includes(mode)) await new Promise(resolve => setTimeout(resolve, 100));
          if (mode === 'throw') throw new Error('query failed');
          return { data: [{ value: mode === 'bad' ? {} : true }], rows: 1,
            statistics: { elapsed_ms: 0.5, rows_read: 10, bytes_read: 100 }, unused: new Target() };
        }
        alive() { return 'borrowed service alive'; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'throw', 'timeout', 'abort']) {
      const response = await mf.dispatchFetch('https://example.test/' + path, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      if (result.rootAfter) assert.match(result.rootAfter, /disposed/i);
      if (path === 'success') {
        assert.equal(result.error, undefined); assert.match(result.rootAfter, /disposed/i);
        const bytes = new Uint8Array(result.bytes), view = new DataView(bytes.buffer);
        assert.equal(view.getUint32(0, true), 1); assert.equal(view.getFloat64(4, true), 0.5);
        assert.equal(view.getBigUint64(12, true), 10n); assert.equal(view.getBigUint64(20, true), 100n);
        assert.deepEqual(Array.from(bytes.subarray(28)), [1,0,0,0, 5,0,0,0, 118,97,108,117,101, 2,0,0,0]);
      }
      if (path === 'bad') { assert.match(result.error.message, /Analytics SQL/); assert.match(result.rootAfter, /disposed/i); }
      if (path === 'throw') assert.match(result.error.message, /query failed/);
      if (path === 'timeout') assert.equal(result.error.name, 'TimeoutError');
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});
