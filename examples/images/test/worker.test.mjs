import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { startLocalWorker } from '../../test/local-worker.mjs';
function chunk(name, data) {
  const payload = Buffer.concat([Buffer.from(name), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(2); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
const pixels = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.concat([pixels, pixels, pixels]))), chunk('IEND', Buffer.alloc(0))]);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"><rect width="7" height="9"/></svg>';
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
