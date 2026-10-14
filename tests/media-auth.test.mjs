import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { authenticatedMediaWorker } from '../examples/media/auth.mjs';
import { testToken, testTokenHash } from '../examples/media/test/fixture.mjs';

test('Media auth fails closed and uses native workerd digest/timing-safe comparison before delegation', { timeout: 15000 }, async () => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'media-auth', compatibilityDate: '2026-10-13', exports: {},
    env: { LIBCF_MEDIA_PROBE_SHA256: { type: 'text', value: testTokenHash } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-media-auth', modules: {
      'worker.mjs': { type: 'esm', contents: `
        const authenticate = (${authenticatedMediaWorker.toString()});
        let calls = 0;
        const worker = { fetch() { return Response.json({ calls: ++calls }); } };
        const guarded = authenticate(worker);
        export default { fetch(request, env, context) {
          if (new URL(request.url).pathname === '/not-configured') env = {};
          return guarded.fetch(request, env, context);
        } };
      ` },
    } },
  } }] });
  const request = (authorization, path = '/') => mf.dispatchFetch(`https://example.test${path}`, {
    method: 'POST', body: 'must not reach Media without auth',
    headers: authorization === undefined ? {} : { authorization }, signal: AbortSignal.timeout(5000),
  });
  try {
    for (const token of [undefined, 'Bearer', `Bearer ${'1'.repeat(64)}`, `Bearer ${'0'.repeat(63)}`, `Basic ${testToken}`]) {
      const result = await request(token);
      assert.equal(result.status, 401);
      assert.equal(await result.text(), 'unauthorized');
    }
    const missing = await request(`Bearer ${testToken}`, '/not-configured');
    assert.equal(missing.status, 503);
    await missing.text();
    const valid = await request(`Bearer ${testToken}`);
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { calls: 1 });
  } finally { await mf.dispose(); }
});
