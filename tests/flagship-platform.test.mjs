import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Native local evaluator only: no C++ adapter, account access or production propagation proof.
test('pinned Flagship evaluates owned flags and distinguishes fallback from runtime rejection', { timeout: 15000 }, async () => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'flagship-platform', compatibilityDate: '2026-10-13', exports: {},
    env: { FLAGS: { type: 'flagship', id: 'libcf-local-audit', dev: { remote: false } } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-flagship-platform', modules: {
      'worker.mjs': { type: 'esm', contents: `
        export default { async fetch(request, env) {
          const released = new WeakSet();
          function release(...values) {
            for (const value of values) {
              if (value === env.FLAGS || value === null || !['object', 'function'].includes(typeof value) || released.has(value)) continue;
              released.add(value);
              value[Symbol.dispose]?.();
            }
          }
          async function call(receiver, method, ...args) {
            const pending = receiver[method](...args);
            let result;
            try {
              result = await pending;
              return result === undefined ? null : JSON.parse(JSON.stringify(result));
            } finally { release(result, pending); }
          }
          async function failure(method, ...args) {
            try { await call(env.FLAGS, method, ...args); return 'unexpected success'; }
            catch (error) { return error.message; }
          }
          // Miniflare's private fixture seeding API; never expose this as a libcf admin API.
          const acquisition = env.FLAGS['FlagshipBinding::admin_api']();
          let admin;
          try {
            admin = await acquisition;
            for (const [key, enabled] of [['static', true], ['disabled', false]]) {
              await call(admin, 'putFlag', { key, enabled, default_variation: 'off',
                variations: { on: true, off: false }, rules: [] });
            }
            const active = await call(env.FLAGS, 'getBooleanDetails', 'static', true);
            const disabled = await call(env.FLAGS, 'getBooleanDetails', 'disabled', true);
            const missing = await call(env.FLAGS, 'getBooleanDetails', 'missing', true);
            const mismatch = await call(env.FLAGS, 'getStringDetails', 'static', 'fallback');
            const invalid = await failure('getBooleanDetails', '', false);
            // Newer workers-types declarations alone do not establish pinned runtime support.
            const generic = await failure('getValue', 'static', false);
            const recovery = await call(env.FLAGS, 'getBooleanValue', 'static', true);
            await call(admin, 'deleteFlag', 'static');
            await call(admin, 'deleteFlag', 'disabled');
            const after = await call(env.FLAGS, 'getBooleanDetails', 'static', true);
            return Response.json({ active, disabled, missing, mismatch, invalid, generic, recovery, after });
          } finally { release(admin, acquisition); }
        } };
      ` },
    } },
  } }] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.active, { flagKey: 'static', value: false, variant: 'off', reason: 'STATIC' });
    assert.deepEqual(result.disabled, { flagKey: 'disabled', value: false, variant: 'off', reason: 'DISABLED' });
    for (const detail of [result.missing, result.after]) {
      assert.equal(detail.value, true);
      assert.equal(detail.reason, 'ERROR');
      assert.equal(detail.errorCode, 'FLAG_NOT_FOUND');
    }
    assert.equal(result.mismatch.value, 'fallback');
    assert.equal(result.mismatch.reason, 'ERROR');
    assert.equal(result.mismatch.errorCode, 'TYPE_MISMATCH');
    assert.match(result.invalid, /flagKey must be a non-empty string/);
    assert.match(result.generic, /does not implement the method "getValue"/);
    assert.equal(result.recovery, false);
  } finally { await mf.dispose(); }
});
