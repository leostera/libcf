import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Miniflare } from 'miniflare';

// This fixture must NEVER acquire/connect a browser or download Chrome.
// Review routing/launch behavior before updating these pinned source guards.
// Merely observing an empty session list would not exclude a transient launch.
async function assertNoLaunchImplementation() {
  const entry = createRequire(import.meta.url).resolve('miniflare');
  for (const [path, expected] of [
    [entry, '141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482'],
    [join(dirname(entry), 'workers/browser-rendering/binding.worker.js'), '7aae43fc0deaab6675e9cc08dd4919b1af2c34c77ce176d83dece5330bb26c50'],
  ]) {
    const digest = createHash('sha256').update(await readFile(path)).digest('hex');
    assert.equal(digest, expected, 'Review Browser routing before running the no-launch fixture with changed Miniflare sources');
  }
}

test('pinned local Browser rejects Quick Actions without acquiring Chrome; limits/history are synthetic', { timeout: 15000 }, async () => {
  await assertNoLaunchImplementation();
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'browser-no-launch', compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], exports: {},
    env: { BROWSER: { type: 'browser' } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-browser-no-launch', modules: {
      'worker.mjs': { type: 'esm', contents: `
        export default { async fetch(request, env) {
          const read = async path => {
            const response = await env.BROWSER.fetch('http://browser.invalid' + path);
            if (response.status !== 200) throw new Error('unexpected local Browser status');
            return response.json();
          };
          const before = await read('/v1/sessions');
          let quickActionFailure;
          try {
            const response = await env.BROWSER.quickAction('screenshot', {
              html: '<!doctype html><p>owned fixture</p>', setJavaScriptEnabled: false,
              rejectRequestPattern: ['.*'], cacheTTL: 0,
            });
            await response.body?.cancel();
            quickActionFailure = 'unexpected Quick Action success';
          } catch (error) { quickActionFailure = error.message; }
          const after = await read('/v1/sessions');
          return Response.json({ before, after, quickActionFailure,
            limits: await read('/v1/limits'), history: await read('/v1/history') });
        } };
      ` },
    } },
  } }] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.before, { sessions: [] });
    assert.deepEqual(result.after, { sessions: [] });
    assert.match(result.quickActionFailure, /RPC receiver does not implement the method ["']quickAction["']/);
    assert.deepEqual(result.limits, { maxConcurrentSessions: 6, allowedBrowserAcquisitions: 6,
      timeUntilNextAllowedBrowserAcquisition: 0 });
    assert.deepEqual(result.history, []);
  } finally { await mf.dispose(); }
});
