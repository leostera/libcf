import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { liveHttp } from '../scripts/live-http.mjs';

test('live probes reject other namespaces before making a request', () => {
  for (const host of [undefined, '', 'example.com', 'test.workers.dev',
    'libcf-cache-0123456789.libcf.leostera.dev.evil.test',
    'libcf-cache-0123456789.libcf.leostera.dev/path',
    'libcf-cache-0123456789.libcf.leostera.dev:443',
    'libcf-d1-0123456789.libcf.leostera.dev']) {
    assert.throws(() => liveHttp(host, 'cache'), /isolated test hostname/);
  }
  assert.throws(() => liveHttp('anything', '.*'), /isolated test hostname/);
});

test('each supported family is confined to its own isolated hostname pattern', () => {
  for (const family of ['cache', 'd1', 'kv', 'r2', 'core', 'service', 'durable', 'events', 'websocket', 'rate-limit', 'metadata', 'crypto', 'timer', 'images', 'http-client', 'http-upstream', 'workflow', 'clock', 'rpc', 'service-tcp', 'media']) {
    assert.equal(typeof liveHttp(`libcf-${family}-0123456789.libcf.leostera.dev`, family), 'function');
    assert.throws(() => liveHttp('libcf-other-0123456789.libcf.leostera.dev', family));
  }
});

test('build-only adapter rejects invalid resources before producing artifacts', () => {
  for (const args of [
    ['unknown'], ['core'], ['kv', 'bad-id'], ['d1', 'bad-id'],
    ['r2', 'existing-production-bucket'], ['service', 'unexpected-binding-id'], ['rate-limit', '1001'], ['metadata', 'existing-secret-store'], ['crypto', 'unexpected-binding'], ['timer', 'unexpected-binding'], ['images', 'unexpected-binding'], ['http-client', 'unexpected-binding'], ['workflow', 'existing-workflow'], ['clock', 'unexpected-binding'], ['rpc', 'unexpected-binding'], ['rpc', ''], ['service-tcp', 'unexpected-binding'], ['service-tcp', ''], ['media', 'unexpected-binding'], ['media', ''],
    ['events', '00000000-0000-0000-0000-000000000002', 'existing-production-queue'],
  ]) {
    const child = spawnSync(process.execPath, ['scripts/build-live-worker.mjs', ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1, child.stdout);
    assert.match(child.stderr, /Choose|requires|required/);
  }
});

test('live requests enforce HTTPS, redirect rejection and a bounded timeout', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('ok'); };
  try {
    const request = liveHttp('libcf-d1-0123456789.libcf.leostera.dev', 'd1');
    await request('/first-null', { redirect: 'follow' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://libcf-d1-0123456789.libcf.leostera.dev/first-null');
    assert.equal(calls[0].options.redirect, 'error');
    assert(calls[0].options.signal instanceof AbortSignal);
    assert.equal(calls[0].options.signal.aborted, false);
  } finally {
    globalThis.fetch = original;
  }
});
