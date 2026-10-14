import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Real service RPC, fake repository metadata. Never an Artifacts binding or account operation.
test('Artifacts metadata holds repository/result RPC roots and drains canceled acquisition/read', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { performArtifactsInfo as perform } from './lib/artifacts.mjs';
    export default { async fetch(request, env) {
      const mode = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let repository, result, drain;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { get(key) {
        const native = env.REFERENCE.get(key);
        const observed = Promise.resolve(native).then(value => {
          repository = value;
          let readStarted = false;
          return { info() {
            readStarted = true;
            let read;
            try { read = value.info(); } catch (error) { drain(); throw error; }
            const observed = Promise.resolve(read).then(value => { result = value; drain(); return value; },
              error => { drain(); throw error; });
            observed[Symbol.dispose] = () => read[Symbol.dispose]();
            return observed;
          }, [Symbol.dispose]() { value[Symbol.dispose](); if (!readStarted) drain(); } };
        }, error => { drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose]();
        return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed namespace disposed'); } };
      let error, bytes;
      const pending = perform(binding, mode, new Uint8Array(), mode.includes('timeout') ? '20' : '5000', controller.signal);
      if (mode === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained; await new Promise(resolve => setTimeout(resolve, 0));
      let repositoryAfter, resultAfter;
      if (repository) { try { repositoryAfter = await repository.ping(); } catch (error) { repositoryAfter = error.message; } }
      if (result?.unused) { try { resultAfter = await result.unused.ping(); } catch (error) { resultAfter = error.message; } }
      return Response.json({ error, bytes, repositoryAfter, resultAfter, alive: await env.REFERENCE.alive() });
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-artifacts-rpc/' + name,
      modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 'unexpected alive'; } }
      class Repository extends RpcTarget {
        constructor(name) { super(); this.name = name; }
        ping() { return 'unexpected alive'; }
        async info() {
          if (['read-timeout', 'abort'].includes(this.name)) await new Promise(resolve => setTimeout(resolve, 100));
          if (this.name === 'read-fail') throw new Error('read failed');
          return { id: this.name === 'bad' ? null : 'id', name: this.name, defaultBranch: 'main', readOnly: false, unused: new Target() };
        }
      }
      export class Reference extends WorkerEntrypoint {
        async get(name) {
          if (name === 'get-timeout') await new Promise(resolve => setTimeout(resolve, 100));
          if (name === 'missing') throw new Error('not found');
          return new Repository(name);
        }
        alive() { return 'borrowed namespace alive'; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'missing', 'read-fail', 'get-timeout', 'read-timeout', 'abort']) {
      const response = await mf.dispatchFetch('https://example.test/' + path, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed namespace alive');
      if (result.repositoryAfter) assert.match(result.repositoryAfter, /disposed/i);
      if (result.resultAfter) assert.match(result.resultAfter, /disposed/i);
      if (path === 'success') {
        assert.equal(result.error, undefined);
        assert.match(result.repositoryAfter, /disposed/i); assert.match(result.resultAfter, /disposed/i);
        assert.deepEqual(result.bytes, [0,0,0,0, 2,0,0,0, 105,100, 7,0,0,0, 115,117,99,99,101,115,115, 4,0,0,0, 109,97,105,110]);
      }
      if (path === 'bad') { assert.match(result.error.message, /invalid Artifacts metadata/); assert.match(result.resultAfter, /disposed/i); }
      if (path === 'missing') assert.match(result.error.message, /not found/);
      if (path === 'read-fail') assert.match(result.error.message, /read failed/);
      if (path.includes('timeout')) assert.equal(result.error.name, 'TimeoutError');
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});
