import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const worker = (name, contents, env = {}, exports = {}) => ({ config: {
  name, compatibilityDate: '2026-10-13', env, exports,
  manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-flagship-rpc/${name}`,
    modules: { 'worker.mjs': { type: 'esm', contents } } },
} });
async function bundle(contents) {
  const built = await build({ stdin: { resolveDir: process.cwd(), contents }, bundle: true,
    write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  return built.outputFiles[0].text;
}

test('Flagship adapter holds RPC roots through projection and drains canceled reads (fake evaluator)', { timeout: 20000 }, async () => {
  const client = await bundle(`
    import { performFlagshipBooleanDetails as perform } from './lib/flagship.mjs';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname.slice(1), controller = new AbortController();
      let root, drain;
      const drained = new Promise(resolve => { drain = resolve; });
      const binding = { getBooleanDetails(key, fallback) {
        const native = env.REFERENCE.getBooleanDetails(key, fallback);
        const observed = Promise.resolve(native).then(value => { root = value; drain(); return value; },
          error => { drain(); throw error; });
        observed[Symbol.dispose] = () => native[Symbol.dispose]();
        return observed;
      }, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
      let error, bytes;
      const pending = perform(binding, path, new Uint8Array(), path === 'timeout' ? '1:20' : '1:5000', controller.signal);
      if (path === 'abort') setTimeout(() => controller.abort(), 10);
      try { bytes = Array.from((await pending).bytes); }
      catch (failure) { error = { name: failure.name, message: failure.message }; }
      await drained;
      await new Promise(resolve => setTimeout(resolve, 0));
      let rootAfter;
      if (root?.unused) { try { rootAfter = await root.unused.ping(); } catch (error) { rootAfter = error.message; } }
      return Response.json({ error, bytes, rootAfter, alive: await env.REFERENCE.alive() });
    } };
  `);
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client, { REFERENCE: { type: 'worker', worker: 'reference', exportName: 'Reference' } }),
    worker('reference', `
      import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
      class Target extends RpcTarget { ping() { return 'unexpected alive'; } }
      export class Reference extends WorkerEntrypoint {
        async getBooleanDetails(key, fallback) {
          if (['timeout', 'abort'].includes(key)) await new Promise(resolve => setTimeout(resolve, 100));
          if (key === 'throw') throw new Error('provider failure');
          return { flagKey: key, value: key === 'bad' ? 1 : false, unused: new Target() };
        }
        alive() { return 'borrowed service alive'; }
      }
      export default { fetch() { return new Response('not found', { status: 404 }); } };
    `, {}, { Reference: { type: 'worker' } }),
  ] });
  try {
    for (const path of ['success', 'bad', 'throw', 'timeout', 'abort']) {
      const response = await mf.dispatchFetch(`https://example.test/${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.alive, 'borrowed service alive');
      if (result.rootAfter) assert.match(result.rootAfter, /disposed/i);
      if (path === 'success') {
        assert.equal(result.error, undefined); assert.match(result.rootAfter, /disposed/i);
        assert.deepEqual(result.bytes, Array(20).fill(0));
      }
      if (path === 'bad') {
        assert.match(result.error.message, /invalid Flagship details/);
        assert.match(result.rootAfter, /disposed/i);
      }
      if (path === 'throw') assert.match(result.error.message, /provider failure/);
      if (path === 'timeout') assert.equal(result.error.name, 'TimeoutError');
      if (path === 'abort') assert.equal(result.error.name, 'AbortError');
    }
  } finally { await mf.dispose(); }
});

test('Flagship adapter projects real local evaluator details with owned synthetic flags', { timeout: 15000 }, async () => {
  const client = await bundle(`
    import { performFlagshipBooleanDetails as perform } from './lib/flagship.mjs';
    export default { async fetch(request, env) {
      // Private simulator seed hook, not a production/application API.
      const acquisition = env.FLAGS['FlagshipBinding::admin_api']();
      let admin;
      try {
        admin = await acquisition;
        await admin.putFlag({ key: 'owned', enabled: true, default_variation: 'off',
          variations: { off: false }, rules: [] });
        const results = await Promise.all(Array.from({ length: 8 }, () =>
          perform(env.FLAGS, 'owned', new TextEncoder().encode('synthetic-user'), '1:5000')));
        await admin.deleteFlag('owned');
        const missing = await perform(env.FLAGS, 'owned', new Uint8Array(), '1:5000');
        return Response.json({ results: results.map(value => Array.from(value.bytes)), missing: Array.from(missing.bytes) });
      } finally {
        admin?.[Symbol.dispose]?.();
        if (acquisition !== admin) acquisition[Symbol.dispose]?.();
      }
    } };
  `);
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [worker('native', client,
    { FLAGS: { type: 'flagship', id: 'libcf-owned-adapter-test', dev: { remote: false } } })] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    const expected = [0,0,0,0, 1,0,0,0, 3,0,0,0, 111,102,102, 1,0,0,0, 6,0,0,0, 83,84,65,84,73,67, 0,0,0,0, 0,0,0,0];
    assert.deepEqual(result.results, Array.from({ length: 8 }, () => expected));
    const missing = new Uint8Array(result.missing);
    assert.equal(new DataView(missing.buffer).getUint32(0, true), 1);
    assert(new TextDecoder().decode(missing).includes('FLAG_NOT_FOUND'));
  } finally { await mf.dispose(); }
});
