import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/ai-gateway/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const lookup = (body = '', path = '/url') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const endpoint = (id, provider = 'openai', account = 'synthetic-account') => `https://gateway.ai.cloudflare.com/v1/${account}/${id}/${provider}`;
test('actual C++/Wasm owns canonical URL metadata from fake gateways, never fetching endpoints', async () => {
  for (const [path, provider] of [['/url', 'openai'], ['/universal', ''], ['/explicit-universal', '']]) {
    const response = await lookup('', path); assert.equal(response.status, 200); assert.equal(await response.text(), endpoint('libcf-owned-gateway', provider));
  }
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const id = `synthetic-${i}`, response = await lookup(id); assert.equal(response.status, 200); assert.equal(await response.text(), endpoint(id));
  }));
  const id = 'g'.repeat(64), maximum = await lookup(id, '/provider-max'); assert.equal(maximum.status, 200);
  const text = await maximum.text(); assert.equal(text.length, 295); assert.equal(text, endpoint(id, 'p'.repeat(64), 'a'.repeat(128)));
});
test('input, backend, canonical shape, cleanup and both-stage deadline failures recover', async () => {
  for (const id of ['x'.repeat(65), 'bad/name', 'bad\n', 'Upper', new Uint8Array([255]), 'lookup-fail', 'read-fail', 'bad-host', 'bad-type', 'bad-id', 'bad-provider', 'cleanup-fail']) {
    const response = await lookup(id); assert.equal(response.status, 502); assert.equal(await response.text(), 'AI Gateway URL lookup failed');
  }
  for (const id of ['lookup-slow', 'read-slow']) {
    const response = await lookup(id, '/short-timeout'); assert.equal(response.status, 502); assert.equal(await response.text(), 'AI Gateway URL lookup failed');
  }
  const missing = await lookup('', '/missing'); assert.equal(missing.status, 502); await missing.arrayBuffer();
  const recovery = await lookup(); assert.equal(recovery.status, 200); await recovery.arrayBuffer();
});
test('ordinary harness rejects native Workers AI/Gateway configuration', async () => {
  await assert.rejects(startLocalWorker('examples/ai-gateway/wrangler.jsonc'), /Workers AI and AI Gateway use remote services/);
});
