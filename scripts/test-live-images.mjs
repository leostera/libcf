import assert from 'node:assert/strict';
import { png, svg } from '../examples/images/test/fixtures.mjs';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'images');
await awaitCertificate(request);
async function info(body, path = '/info') {
  const response = await request(path, { method: 'POST', body });
  return { status: response.status, text: await response.text() };
}
assert.deepEqual(await info(png), { status: 200, text: `image/png 2x3 ${png.length}` });
assert.deepEqual(await info(svg), { status: 200, text: 'image/svg+xml' });
for (const body of ['', 'not an image']) assert.equal((await info(body)).status, 502);
assert.equal((await info(png, '/missing')).status, 502);
assert.equal((await info('', '/oversized')).status, 502);
assert.equal((await info(png)).status, 200);
console.log(JSON.stringify({ host, passed: ['PNG dimensions/size', 'SVG category', 'invalid/empty/missing/oversized failures', 'recovery'], transformations: false, uploads: false }, null, 2));
