import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { png } from '../examples/images/test/fixtures.mjs';

// Native RPC/Response ownership, with an explicit fake renderer. No browser binding.
test('screenshot adapter retains native RPC Response streams until read and drains canceled calls', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performBrowserScreenshot } from './lib/browser.mjs';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname.slice(1);
      const controller = new AbortController();
      let retained, nativeFailure, drain, releases = 0;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { quickAction(action, options) {
        const native = env.REFERENCE.quickAction(action, options);
        const observed = Promise.resolve(native).then(value => {
          retained = value; drain(); return value;
        }, error => { nativeFailure = error.message; drain(); throw error; });
        observed[Symbol.dispose] = () => { ++releases; native[Symbol.dispose](); };
        return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, bytes;
      const operation = performBrowserScreenshot(binding, '', new TextEncoder().encode(path),
        ['timeout', 'body-timeout'].includes(path) ? '128:128:20' : '128:128:5000', controller.signal);
      if (path === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await operation).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained;
      await new Promise(resolve => setTimeout(resolve, 0));
      return Response.json({ error, bytes, nativeFailure, releases,
        locked: retained?.body?.locked, bodyUsed: retained?.bodyUsed,
        alive: await env.REFERENCE.alive() });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-browser-rpc/${name}`,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint } from 'cloudflare:workers';
      const png = new Uint8Array(${JSON.stringify(Array.from(png))});
      export class Reference extends WorkerEntrypoint {
        alive() { return 'borrowed service alive'; }
        async quickAction(action, options) {
          if (action !== 'screenshot' || options.setJavaScriptEnabled !== false || options.cacheTTL !== 0)
            throw new Error('unexpected renderer options');
          if (['timeout', 'abort'].includes(options.html)) await new Promise(resolve => setTimeout(resolve, 100));
          if (options.html === 'bad') return new Response('owned error', { status: 503 });
          let step = 0;
          return new Response(new ReadableStream({ async pull(controller) {
            if (options.html === 'body-timeout') await new Promise(resolve => setTimeout(resolve, 100));
            if (step++ === 0) controller.enqueue(png.slice(0, 8));
            else { controller.enqueue(png.slice(8)); controller.close(); }
          } }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } });
        }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'abort', 'timeout', 'body-timeout', 'success']) {
      const response = await mf.dispatchFetch(`https://example.test/${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      assert.equal(result.releases, 1);
      assert.notEqual(result.locked, true);
      if (path === 'success') { assert.equal(result.error, undefined); assert.deepEqual(result.bytes, Array.from(png)); assert.equal(result.bodyUsed, true); }
      if (path === 'bad') assert.match(result.error.message, /invalid Browser screenshot response/);
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
      if (path.includes('timeout')) assert.equal(result.error.name, 'TimeoutError');
    }
  } finally { await mf.dispose(); }
});
