import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
let server;
let root;
let echoCalls = 0;
before(async () => {
  server = createServer(async (request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: '/echo' }); response.end(); return; }
    if (request.url === '/empty') { response.writeHead(204); response.end(); return; }
    if (request.url === '/large') { response.end(Buffer.alloc(1048577)); return; }
    if (request.url === '/failure') { response.destroy(); return; }
    if (request.url !== '/echo') { response.writeHead(404); response.end(); return; }
    echoCalls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(201, { 'content-type': 'application/octet-stream', 'x-upstream-method': request.method,
      'x-client': request.headers['x-client'] ?? '', 'x-has-authorization': String(Boolean(request.headers.authorization)) });
    response.end(Buffer.concat(chunks));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  root = await mkdtemp(resolve(tmpdir(), 'libcf-http-client-'));
  const config = `${root}/worker.jsonc`;
  await writeFile(config, JSON.stringify({ name: 'libcf-http-client-local', main: resolve('examples/http-client/worker.mjs'),
    compatibility_date: '2026-10-13', vars: { UPSTREAM_URL: `http://127.0.0.1:${server.address().port}` } }));
  worker = await startLocalWorker(config);
});
after(async () => {
  try { await worker?.dispose(); }
  finally {
    if (server?.listening) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test('global HTTP fetch preserves binary/status/selected headers without proxying credentials', async () => {
  const body = new Uint8Array([0, 255, 1, 128]);
  const response = await fetch(`${worker.base}/echo`, { method: 'POST', body,
    headers: { 'x-client': 'fixture', authorization: 'synthetic-not-a-credential' } });
  assert.equal(response.status, 201);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  assert.equal(response.headers.get('x-upstream-method'), 'POST');
  assert.equal(response.headers.get('x-client'), 'fixture');
  assert.equal(response.headers.get('x-has-authorization'), 'false');
});

test('redirects are manual by default, with explicit follow and error policies', async () => {
  const before = echoCalls;
  const manual = await fetch(`${worker.base}/manual`, { redirect: 'manual' });
  assert.equal(manual.status, 302);
  assert.equal(manual.headers.get('location'), '/echo');
  await manual.arrayBuffer();
  assert.equal(echoCalls, before);
  const error = await fetch(`${worker.base}/error`);
  assert.equal(error.status, 502);
  await error.arrayBuffer();
  assert.equal(echoCalls, before);
  const followed = await fetch(`${worker.base}/follow`);
  assert.equal(followed.status, 201);
  await followed.arrayBuffer();
  assert.equal(echoCalls, before + 1);
});

test('empty responses, network failures and output bounds leave later requests usable', async () => {
  const empty = await fetch(`${worker.base}/empty`);
  assert.equal(empty.status, 204);
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
  for (const path of ['/failure', '/large']) {
    const response = await fetch(`${worker.base}${path}`);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), 'upstream failed');
  }
  assert.equal((await fetch(`${worker.base}/echo`)).status, 201);
});
