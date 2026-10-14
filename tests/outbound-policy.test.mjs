import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { parseBoundHttpsPolicy as parse, selectBoundHttpsEndpoint as select } from '../lib/outbound-policy.mjs';
const entry = (overrides = {}) => ({ kind: 'mtls', binding: 'CERT', name: 'health', url: 'https://owned.invalid/health', ...overrides });
const policy = (...entries) => parse(JSON.stringify(entries));

test('opaque snapshots require exact role, binding and name without fallback', () => {
  const source = entry(), token = policy(source); source.url = 'https://changed.invalid/';
  assert(Object.isFrozen(token)); assert.deepEqual(Object.keys(token), []);
  const selected = select(token, 'mtls', 'CERT', 'health'); assert(Object.isFrozen(selected)); assert.equal(selected.url, 'https://owned.invalid/health');
  assert.throws(() => { selected.url = 'https://changed.invalid/'; });
  for (const args of [['vpc-service', 'CERT', 'health'], ['vpc-network', 'CERT', 'health'], ['mtls', 'OTHER', 'health'], ['mtls', 'CERT', 'other']]) assert.throws(() => select(token, ...args), /not configured/);
  assert.throws(() => select({}, 'mtls', 'CERT', 'health'), /token/);
  assert.throws(() => select(policy(), 'mtls', 'CERT', 'health'), /not configured/);
  assert.throws(() => policy(entry(), entry()), /ambiguous/);
  assert.throws(() => policy(entry(), entry({ kind: 'vpc-network', name: 'other' })), /ambiguous/);
  for (const extra of [{ method: 'POST' }, { headers: {} }, { redirect: 'follow' }, { credentials: 'include' }, { body: '' }]) assert.throws(() => policy(entry(extra)), /entry/);
});

test('bounded syntax excludes credentials, query/fragment and URL normalization', () => {
  for (const kind of ['mtls', 'vpc-service', 'vpc-network']) {
    for (const url of ['https://owned.invalid/', 'https://10.0.0.1/health', 'https://[2001:db8::1]/health', 'https://owned.invalid/space%20%E7%8C%AB']) assert(policy(entry({ kind, url })));
    for (const url of ['', 'http://owned.invalid/', 'https://owned.invalid', 'https://OWNED.invalid/', 'https://owned.invalid:443/', 'https://owned.invalid:0/', 'https://owned.invalid./', 'https://user:secret@owned.invalid/', 'https://@owned.invalid/', 'https://owned.invalid/?', 'https://owned.invalid/#', 'https://owned.invalid/?secret=x', 'https://owned.invalid/#x', 'https://owned.invalid/a/../b', 'https://owned.invalid/%2e%2e/b', 'https://owned.invalid/猫', 'https://owned.invalid/\n', ' https://owned.invalid/', 'https://127.1/', 'https://owned.invalid\\x', 'https://[invalid/', 'https://owned.invalid:65536/']) assert.throws(() => policy(entry({ kind, url })), undefined, url);
  }
  assert(policy(entry({ url: 'https://owned.invalid:8443/' })));
  assert(policy(entry({ kind: 'vpc-network', url: 'https://owned.invalid:8443/' })));
  assert.throws(() => policy(entry({ kind: 'vpc-service', url: 'https://owned.invalid:8443/' })), /authority/);
  const prefix = 'https://owned.invalid/'; assert(policy(entry({ url: prefix + 'a'.repeat(2048 - prefix.length) })));
  assert.throws(() => policy(entry({ url: prefix + 'a'.repeat(2049 - prefix.length) })));
  for (const value of ['', 'a', '_A', 'A-B', 'A\n', 'A'.repeat(65), '猫']) assert.throws(() => policy(entry({ binding: value })));
  for (const value of ['', 'A', '-a', 'a/b', 'a\n', 'a'.repeat(65), '__proto__']) assert.throws(() => policy(entry({ name: value })));
  assert(policy(entry({ binding: 'A'.repeat(64), name: 'a'.repeat(64) })));
  assert(policy(entry({ name: 'constructor' })));
  assert.throws(() => policy(entry({ kind: 'fetcher' })));
});

test('JSON caps and diagnostics never echo policy secrets', () => {
  assert(parse('[]' + ' '.repeat(65534))); assert.throws(() => parse('[]' + ' '.repeat(65535)));
  assert(policy(...Array.from({ length: 64 }, (_, i) => entry({ name: 'n' + i }))));
  assert.throws(() => policy(...Array.from({ length: 65 }, (_, i) => entry({ name: 'n' + i }))));
  for (const text of ['', '{}', 'null', '[null]', '[[]]', '[1]', '"text"', '[{"secret":"DO-NOT-ECHO"', '["\ud800"]']) assert.throws(() => parse(text), error => !error.message.includes('DO-NOT-ECHO'));
  assert.throws(() => policy(entry({ url: 'https://DO-NOT-ECHO@[invalid/' })), error => !error.message.includes('DO-NOT-ECHO'));
  assert.throws(() => parse({ toString() { assert.fail('coercion'); } }));
});

test('native workerd policy parsing/selection performs no provider fetch', { timeout: 10000 }, async () => {
  const modules = {};
  for (const file of ['outbound-policy', 'json']) modules[file + '.mjs'] = { type: 'esm', contents: await readFile(new URL('../lib/' + file + '.mjs', import.meta.url), 'utf8') };
  modules['worker.mjs'] = { type: 'esm', contents: `
    import { parseBoundHttpsPolicy, selectBoundHttpsEndpoint } from './outbound-policy.mjs';
    export default { async fetch(request) {
      try {
        const token = parseBoundHttpsPolicy(await request.text());
        return Response.json(selectBoundHttpsEndpoint(token, 'vpc-network', 'NETWORK', 'health'));
      } catch { return new Response('policy rejected', {status: 400}); }
    } };
  ` };
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'outbound-policy', compatibilityDate: '2026-10-13',
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-outbound-policy', modules },
  } }] });
  try {
    for (const url of ['https://owned.invalid/health', 'https://[2001:db8::1]:8443/health']) {
      const body = JSON.stringify([entry({ kind: 'vpc-network', binding: 'NETWORK', url })]);
      const response = await runtime.dispatchFetch('https://example.test/', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); assert.equal((await response.json()).url, url);
    }
    const bad = await runtime.dispatchFetch('https://example.test/', { method: 'POST', body: JSON.stringify([entry()]), signal: AbortSignal.timeout(5000) });
    assert.equal(bad.status, 400); assert.equal(await bad.text(), 'policy rejected');
  } finally { await runtime.dispose(); }
});
