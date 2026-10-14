import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Native Worker-to-Worker HTTP transport, FAKE mTLS/VPC authority. No certificate,
// private routing, account operations, external fetch or TLS identity verification.
test('bound HTTPS GET uses fake local providers without credential forwarding or redirect following', { timeout: 20000 }, async () => {
  const client = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { parseBoundHttpsPolicy } from './lib/outbound-policy.mjs';
    import { performBoundHttpsGet } from './lib/outbound-get.mjs';
    const bindings = { 'mtls': 'CERT', 'vpc-service': 'SERVICE', 'vpc-network': 'NETWORK' };
    const names = ['ok','binary','empty','maximum','oversized','redirect','error','slow'];
    const policy = parseBoundHttpsPolicy(JSON.stringify(Object.entries(bindings).flatMap(([kind,binding]) => names.map(name => ({kind,binding,name,url:'https://owned.invalid/'+name})))));
    export default { async fetch(request, env) {
      const [kind,name] = new URL(request.url).pathname.slice(1).split('/');
      if (kind === 'stats') return Response.json(await env.CERT.stats());
      try {
        const binding = bindings[kind];
        const result = await performBoundHttpsGet(env[binding], policy, kind, binding, name, new Uint8Array(), name === 'slow' ? '10' : '5000');
        return new Response(result.bytes);
      } catch (error) { return new Response(error.name, {status: 502}); }
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'] });
  const worker = (name, contents, env = {}, exports = {}) => ({ config: {
    name, compatibilityDate: '2026-10-13', env, exports,
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-outbound-get/' + name, modules: { 'worker.mjs': { type: 'esm', contents } } },
  } });
  const upstream = { type: 'worker', worker: 'reference', exportName: 'Reference' };
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', client.outputFiles[0].text, { CERT: upstream, SERVICE: upstream, NETWORK: upstream }),
    worker('reference', `
      import { WorkerEntrypoint } from 'cloudflare:workers';
      const counts = {};
      export class Reference extends WorkerEntrypoint {
        async fetch(request) {
          const url = new URL(request.url), path = url.pathname;
          counts[path] = (counts[path] ?? 0) + 1;
          if (url.origin !== 'https://owned.invalid' || request.method !== 'GET' || request.body !== null || request.redirect !== 'manual' ||
              ['authorization','cookie','proxy-authorization','x-client-secret'].some(key => request.headers.has(key))) throw new Error('forwarding mismatch');
          if (path === '/redirect') return new Response('private redirect body', {status:302,headers:{location:'https://owned.invalid/forbidden'}});
          if (path === '/error') return new Response('private error body', {status:403});
          if (path === '/slow') await new Promise(resolve => setTimeout(resolve, 80));
          if (path === '/maximum' || path === '/oversized') return new Response(new Uint8Array(path === '/maximum' ? 1048576 : 1048577).fill(7));
          if (path === '/binary') return new Response(new Uint8Array([0,255,128]));
          if (path === '/empty') return new Response(null);
          return new Response('owned synthetic response');
        }
        stats() { return {...counts}; }
      }
    `, {}, { Reference: {type:'worker'} }),
  ] });
  const get = path => runtime.dispatchFetch('https://example.test' + path, { method: 'POST', body: 'must not forward', headers: { authorization: 'secret', cookie: 'secret', 'proxy-authorization': 'secret', 'x-client-secret': 'secret' }, signal: AbortSignal.timeout(10000) });
  try {
    for (const kind of ['mtls','vpc-service','vpc-network']) {
      const response = await get('/' + kind + '/ok'); assert.equal(response.status, 200); assert.equal(await response.text(), 'owned synthetic response');
    }
    const binary = await get('/mtls/binary'); assert.equal(binary.status, 200); assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), new Uint8Array([0,255,128]));
    const empty = await get('/mtls/empty'); assert.equal(empty.status, 200); assert.equal((await empty.arrayBuffer()).byteLength, 0);
    const maximum = await get('/mtls/maximum'); assert.equal(maximum.status, 200); const bytes = new Uint8Array(await maximum.arrayBuffer()); assert.equal(bytes.length, 1048576); assert(bytes.every(value => value === 7));
    for (const name of ['oversized','redirect','error','slow','forbidden']) { const response = await get('/mtls/' + name); assert.equal(response.status, 502); const text = await response.text(); assert(!text.includes('private')); if (name === 'slow') assert.equal(text, 'TimeoutError'); }
    await Promise.all(Array.from({length:8}, async () => { const response = await get('/mtls/ok'); assert.equal(response.status, 200); assert.equal(await response.text(), 'owned synthetic response'); }));
    const stats = await (await get('/stats')).json(); assert.equal(stats['/forbidden'], undefined); assert.equal(stats['/redirect'], 1); assert.equal(stats['/error'], 1); assert.equal(stats['/slow'], 1);
  } finally { await runtime.dispose(); }
});
