import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { png, svg } from './fixtures.mjs';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/images/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
async function info(body, path = '/info') {
  const response = await fetch(`${worker.base}${path}`, { method: 'POST', body });
  return { status: response.status, text: await response.text() };
}
test('real local Images metadata distinguishes PNG dimensions from SVG', async () => {
  assert.deepEqual(await info(png), { status: 200, text: `image/png 2x3 ${png.length}` });
  assert.deepEqual(await info(svg), { status: 200, text: 'image/svg+xml' });
});
test('invalid/empty images, missing binding and oversize fail with recovery', async () => {
  for (const body of ['', 'not an image']) assert.equal((await info(body)).status, 502);
  assert.equal((await info(png, '/missing')).status, 502);
  assert.equal((await info('', '/oversized')).status, 502);
  assert.equal((await info(png)).status, 200);
});
