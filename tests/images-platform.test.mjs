import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { png } from '../examples/images/test/fixtures.mjs';

// Independent tiny non-interlaced PNG decoder: check CRCs and fully reconstruct
// pixels, not just the MIME/signature/IHDR or the same Sharp implementation.
function decodeTinyPng(bytes) {
  assert(bytes.length <= 4096); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const data = []; let offset = 8, width, height, channels, ended = false;
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length);
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert(offset + 12 + size <= bytes.length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) {
      crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + size));
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      assert.equal(offset, 8); assert.equal(size, 13);
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(width, 3); assert.equal(height, 2); assert.equal(chunk[8], 8);
      assert([2, 6].includes(chunk[9])); channels = chunk[9] === 6 ? 4 : 3;
      assert.deepEqual([...chunk.subarray(10)], [0, 0, 0]);
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') { assert.equal(size, 0); assert.equal(offset + 12, bytes.length); ended = true; }
    offset += 12 + size;
  }
  assert(ended && data.length && channels);
  const stride = width * channels, filtered = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  assert.equal(filtered.length, (stride + 1) * height);
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? raw[y * stride + x - channels] : 0, b = y ? raw[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? raw[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[y * stride + x] = filtered[y * (stride + 1) + 1 + x] + predictor;
    }
  }
  const rgba = [];
  for (let i = 0; i < raw.length; i += channels) rgba.push(raw[i], raw[i + 1], raw[i + 2], channels === 4 ? raw[i + 3] : 255);
  return rgba;
}

test('native local Images transform and hosted owned-data lifecycle feasibility', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-images-platform-')); let runtime;
  try {
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, resourcePersistencePath: root, unsafeEnableSharedStorage: false, workers: [{ config: {
      name: 'images-platform', compatibilityDate: '2026-10-13', env: { IMAGES: { type: 'images' } },
      manifest: { mainModule: 'worker.mjs', modulesRoot: join(root, 'modules'), modules: { 'worker.mjs': { type: 'esm', contents: `
        const png = new Uint8Array(${JSON.stringify([...png])});
        export default { async fetch(request, env) {
          const path = new URL(request.url).pathname;
          if (path === '/rotate') {
            const result = await env.IMAGES.input(new Blob([png]).stream()).transform({rotate:90}).output({format:'image/png'});
            const response = result.response();
            if (result.contentType() !== 'image/png' || response.headers.get('content-type') !== 'image/png') throw new Error('unexpected output type');
            return new Response(await response.arrayBuffer(), {headers:{'content-type':'image/png'}});
          }
          if (path === '/invalid') {
            try { await env.IMAGES.input(new Blob([new Uint8Array([1,2,3])]).stream()).output({format:'image/png'}); }
            catch (error) { return Response.json({name:error.name,message:error.message}, {status:422}); }
            throw new Error('invalid bytes accepted');
          }
          if (path !== '/hosted') return new Response('not found', {status:404});
          const hosted = env.IMAGES.hosted, id = 'libcf-owned-image-probe', image = hosted.image(id);
          if (await image.details() !== null) throw new Error('fixture was not isolated');
          let attempted = false, primary, failed = false;
          try {
            attempted = true;
            const uploaded = await hosted.upload(png.buffer, {id, filename:'owned.png', metadata:{label:'synthetic'}, creator:'libcf-probe'});
            const initial = await image.details(), original = new Uint8Array(await new Response(await image.bytes()).arrayBuffer());
            const listing = await hosted.list({limit:1,creator:'libcf-probe'});
            const filteredOut = await hosted.list({limit:1,creator:'not-our-fixture'});
            await image.update({metadata:{phase:'updated'}});
            const updated = await image.details();
            const deleted = await image.delete(), absent = await image.details(), absentBytes = await image.bytes();
            const after = await hosted.list({limit:1,creator:'libcf-probe'}), secondDelete = await image.delete();
            attempted = false;
            return Response.json({uploaded,initial,bytes:[...original],listing,filteredOut,updated,deleted,absent,absentBytes,after,secondDelete});
          } catch (error) { failed = true; primary = error; throw error; }
          finally {
            const errors = [];
            if (attempted) { try { await image.delete(); } catch (error) { errors.push(error); } }
            if (image !== hosted && image !== env.IMAGES) {
              try { const dispose = image[Symbol.dispose]; if (typeof dispose === 'function') dispose.call(image); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(failed ? [primary, ...errors] : errors, 'Images probe cleanup failed');
          }
        } };
      ` } } },
    } }] });
    const fetchLocal = path => runtime.dispatchFetch('https://example.test' + path, { signal: AbortSignal.timeout(10000) });
    const rotated = await fetchLocal('/rotate'); assert.equal(rotated.status, 200); assert.equal(rotated.headers.get('content-type'), 'image/png');
    assert.deepEqual(decodeTinyPng(Buffer.from(await rotated.arrayBuffer())), [255,0,0,255,255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255,0,255,0,255]);
    const invalid = await fetchLocal('/invalid'); assert.equal(invalid.status, 422); const failure = await invalid.json(); assert.equal(failure.name, 'Error'); assert.match(failure.message, /^Unexpected error response 500: Error: Input buffer contains unsupported image format/);
    const hosted = await fetchLocal('/hosted'); assert.equal(hosted.status, 200); const result = await hosted.json();
    assert.equal(result.uploaded.id, 'libcf-owned-image-probe'); assert.equal(result.initial.filename, 'owned.png'); assert.deepEqual(result.initial.meta, {label:'synthetic'});
    assert.deepEqual(result.bytes, [...png]); assert.equal(result.listing.images.length, 1); assert.equal(result.listing.images[0].id, result.uploaded.id);
    assert.deepEqual(result.filteredOut.images, []);
    assert.deepEqual(result.updated.meta, {phase:'updated'}); assert.equal(result.deleted, true); assert.equal(result.absent, null); assert.equal(result.absentBytes, null);
    assert.deepEqual(result.after.images, []); assert.equal(result.secondDelete, false);
    console.log('native local Images: rotated pixels verified; hosted upload/read/list/update/delete/readback verified', {name:failure.name,message:failure.message.split('\n')[0]});
  } finally {
    try { await runtime?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
