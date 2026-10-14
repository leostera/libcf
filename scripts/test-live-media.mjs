import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { syntheticVideo } from '../examples/media/test/video-fixture.mjs';
import { liveHttp, awaitCertificate } from './live-http.mjs';
import { readBounded } from '../lib/body.mjs';

const host = process.argv[2];
assert.equal(process.argv.length, 3, 'Pass one isolated Media hostname');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS verification must remain enabled');
const request = liveHttp(host, 'media');
const tokenFile = process.env.LIBCF_MEDIA_PROBE_TOKEN_FILE;
if (!tokenFile || !isAbsolute(tokenFile) || basename(tokenFile) !== 'probe-token')
  throw new Error('LIBCF_MEDIA_PROBE_TOKEN_FILE must name an absolute generated probe-token file');
const deployment = JSON.parse(await readFile(join(dirname(tokenFile), 'test-deployment.json'), 'utf8'));
if (deployment.example !== 'media' || deployment.hostname !== host ||
    typeof deployment.root !== 'string' || resolve(deployment.root) !== dirname(tokenFile))
  throw new Error('Media probe token does not belong to this deployment');
const info = await lstat(tokenFile);
if (!info.isFile() || info.size !== 64 || (info.mode & 0o077)) throw new Error('Expected a private 64-byte token file');
const token = await readFile(tokenFile, 'utf8');
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid Media probe token');
const authorization = `Bearer ${token}`;
const video = syntheticVideo();
async function call(path, body, auth = authorization) {
  const response = await request(path, { method: 'POST', body, headers: auth ? { authorization: auth } : {} });
  const bytes = await readBounded(response.body, 1048576, AbortSignal.timeout(10000));
  return { status: response.status, type: response.headers.get('content-type'), bytes };
}
function checkFrame(result) {
  assert.equal(result.status, 200, 'Native Media frame did not succeed');
  assert.equal(result.type, 'image/png');
  assert.deepEqual([...result.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  assert.equal(view.getUint32(8), 13);
  assert.equal(new TextDecoder().decode(result.bytes.subarray(12, 16)), 'IHDR');
  assert.equal(view.getUint32(16), 128);
  assert.equal(view.getUint32(20), 128);
}
// Readiness and unauthorized checks invoke no Media processing. Never retry a
// transformation: at most two successful-frame attempts and one malformed input.
await awaitCertificate(request, 401);
assert.equal((await call('/frame', video, null)).status, 401);
assert.equal((await call('/frame', video, `Bearer ${token[0] === '0' ? '1' : '0'}${token.slice(1)}`)).status, 401);
const first = await call('/frame', video);
checkFrame(first);
for (const path of ['/missing', '/oversized', '/invalid-size'])
  assert.equal((await call(path, video)).status, 502);
assert.equal((await call('/frame', new Uint8Array())).status, 502);
assert.equal((await call('/frame', 'not a video')).status, 502);
checkFrame(await call('/frame', video));
console.log(JSON.stringify({ host, passed: ['authentication before processing', 'synthetic animated GIF to PNG',
  '128x128 output header', 'invalid/empty/missing/oversized/size failures', 'recovery'],
  inputBytes: video.byteLength, inputSha256: createHash('sha256').update(video).digest('hex'),
  outputBytes: first.bytes.byteLength, maxTransformationAttempts: 3,
  pixelContentVerified: false, mp4Verified: false, remoteCancellationVerified: false }, null, 2));
