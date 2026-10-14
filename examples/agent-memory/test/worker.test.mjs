import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/agent-memory/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const list = (body = '', path = '/list') => fetch(`${worker.base}${path}`, { method: 'POST', body });
const firstPage = 'count=2\ncursor=page-2\nmemory-猫\t0\t\ufeffsummary\0owned\tnull\t-1\t1\ntask\t3\t\tvalue:\t0\t1000\n';

test('C++/Wasm memory list projects enums, Dates and nullable sessions, with explicit pagination', async () => {
  const first = await list();
  assert.equal(first.status, 200); assert.equal(await first.text(), firstPage);
  const second = await list('page-2');
  assert.equal(second.status, 200); assert.equal(await second.text(), 'count=0\ncursor=<none>\n');
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const cursor = `echo-${i}-猫😀\0`;
    const response = await list(cursor);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `count=1\ncursor=<none>\nmemory-猫\t0\t${cursor}\tnull\t-1\t1\n`);
  }));
  const bom = await list('\ufeffcursor猫\0');
  assert.equal(bom.status, 200);
  assert.equal(await bom.text(), 'count=1\ncursor=<none>\nmemory-猫\t0\t\ufeffcursor猫\0\tnull\t-1\t1\n');
});

test('maximum cursor and projected wire/date boundaries survive the C++/Wasm bridge', async () => {
  const cursor = await list('c'.repeat(2048));
  assert.equal(cursor.status, 200); assert.equal(await cursor.text(), 'count=0\ncursor=<none>\n');
  const maximum = await list('maximum', '/maximum');
  assert.equal(maximum.status, 200);
  const row = `${'i'.repeat(128)}\t3\t${'s'.repeat(4096)}\tvalue:${'s'.repeat(64)}\t-8640000000000000\t8640000000000000\n`;
  assert.equal(await maximum.text(), `count=50\ncursor=${'c'.repeat(2048)}\n${row.repeat(50)}`);
});

test('input, output, cleanup failure, missing binding and deadline preserve recovery', async () => {
  for (const cursor of ['c'.repeat(2049), new Uint8Array([255]), 'fail', 'bad-date', 'bad-type', 'oversized', 'bad-cursor', 'cleanup-fail']) {
    const response = await list(cursor);
    assert.equal(response.status, 502); assert.equal(await response.text(), 'Agent Memory list failed');
  }
  for (const path of ['/missing', '/invalid-profile', '/short-timeout']) {
    const response = await list(path === '/short-timeout' ? 'slow' : '', path);
    assert.equal(response.status, 502); assert.equal(await response.text(), 'Agent Memory list failed');
  }
  const recovered = await list();
  assert.equal(recovered.status, 200); assert.equal(await recovered.text(), firstPage);
});

test('default local harness refuses the production Agent Memory configuration', async () => {
  await assert.rejects(startLocalWorker('examples/agent-memory/wrangler.jsonc'), /explicit local mock/);
});
