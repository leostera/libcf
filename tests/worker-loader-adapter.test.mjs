import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performWorkerLoader } from '../lib/worker-loader.mjs';
import { readBounded } from '../lib/body.mjs';
import { encodeHeaders } from '../lib/header-wire.mjs';
const wire = new Uint8Array(Buffer.from('030000004745540000000000000000', 'hex'));
const helpers = { readBounded, encodeHeaders, encodeFields: () => new Uint8Array([7]) };
const url = 'https://isolated.libcf.leostera.dev/';

test('cache identity covers source and all isolated WorkerCode settings', async () => {
  const seen = [];
  const binding = { get(id, callback) {
    const code = callback();
    seen.push({ id, code });
    assert.equal(callback(), code);
    return { getEntrypoint() { return { fetch(request) {
      assert.equal(request.url, url);
      return new Response('child');
    } }; } };
  } };
  for (const source of ['first', 'first', 'second'])
    assert.deepEqual(await performWorkerLoader(binding, url, wire, source, helpers), { status: 0, bytes: new Uint8Array([7]) });
  assert.equal(seen[0].id, seen[1].id);
  assert.notEqual(seen[0].id, seen[2].id);
  assert.deepEqual(seen[0].code, {
    compatibilityDate: '2026-10-13', compatibilityFlags: [], mainModule: 'main.js',
    modules: { 'main.js': 'first' }, env: {}, globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 0 },
  });
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(seen[0].code))));
  assert.equal(seen[0].id, `libcf:${digest.toString('hex')}`);
});

test('bad source and malformed HTTP wire reject before obtaining a stub', async () => {
  let calls = 0;
  const binding = { get() { calls++; throw new Error('must not load'); } };
  for (const source of ['', null, 'x'.repeat(65537), '☁'.repeat(21846)])
    await assert.rejects(performWorkerLoader(binding, url, wire, source, helpers), /source/);
  await assert.rejects(performWorkerLoader(binding, url, new Uint8Array(), 'valid', helpers), /truncated/);
  assert.equal(calls, 0);
});
