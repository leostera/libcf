import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeTinyPng, rotatedPixels } from '../examples/images/test/png-decode.mjs';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { png } from '../examples/images/test/fixtures.mjs';

test('native local Images transform and hosted owned-data lifecycle feasibility', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-images-platform-')); let runtime;
  try {
    const adapter = await build({ stdin: {
      contents: `export { performImageRotate } from './lib/image-rotate.mjs';`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    }, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false });
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, resourcePersistencePath: root, unsafeEnableSharedStorage: false, workers: [{ config: {
      name: 'images-platform', compatibilityDate: '2026-10-13', env: { IMAGES: { type: 'images' } },
      manifest: { mainModule: 'worker.mjs', modulesRoot: join(root, 'modules'), modules: { 'adapter.mjs': { type: 'esm', contents: adapter.outputFiles[0].text }, 'worker.mjs': { type: 'esm', contents: `
        import { performImageRotate } from './adapter.mjs';
        const png = new Uint8Array(${JSON.stringify([...png])});
        export default { async fetch(request, env) {
          const path = new URL(request.url).pathname;
          if (path === '/adapter') {
            const result = await performImageRotate(env.IMAGES, png, '5000');
            return new Response(result.bytes, {headers:{'content-type':'image/png'}});
          }
          if (path === '/rotate') {
            const result = await env.IMAGES.input(new Blob([png]).stream()).transform({rotate:90}).output({format:'image/png'});
            const response = result.response();
            if (result.contentType() !== 'image/png' || response.headers.get('content-type') !== 'image/png') throw new Error('unexpected output type');
            return new Response(await response.arrayBuffer(), {headers:{'content-type':'image/png'}});
          }
          if (path === '/ownership') {
            const input = env.IMAGES.input(new Blob([png]).stream());
            const transformed = input.transform({rotate:90});
            const result = await transformed.output({format:'image/png'});
            const body = result.image();
            const bodyAlias = body === result.image();
            const response = result.response();
            const responseAlias = response.body === body;
            await response.arrayBuffer();
            let reuseCode;
            try { await input.output({format:'image/png'}); }
            catch (error) { reuseCode = error.code; }
            return Response.json({transformAlias:input === transformed,bodyAlias,responseAlias,reuseCode});
          }
          if (path === '/invalid') {
            const input = env.IMAGES.input(new Blob([new Uint8Array([1,2,3])]).stream());
            try { await input.output({format:'image/png'}); }
            catch (error) {
              let reuseCode;
              try { await input.output({format:'image/png'}); }
              catch (reuseError) { reuseCode = reuseError.code; }
              return Response.json({name:error.name,code:error.code,message:error.message,reuseCode}, {status:422});
            }
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
    const adapted = await fetchLocal('/adapter'); assert.equal(adapted.status, 200);
    assert.deepEqual(decodeTinyPng(Buffer.from(await adapted.arrayBuffer())), [255,0,0,255,255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255,0,255,0,255]);
    const parallel = await Promise.all(Array.from({length:8}, () => fetchLocal('/adapter')));
    for (const response of parallel) { assert.equal(response.status, 200); assert.deepEqual(decodeTinyPng(Buffer.from(await response.arrayBuffer())), rotatedPixels); }
    const ownership = await fetchLocal('/ownership'); assert.equal(ownership.status, 200);
    assert.deepEqual(await ownership.json(), {transformAlias:true,bodyAlias:true,responseAlias:true,reuseCode:9525});
    const invalid = await fetchLocal('/invalid'); assert.equal(invalid.status, 422); const failure = await invalid.json(); assert.equal(failure.name, 'Error'); assert.match(failure.message, /^Unexpected error response 500: Error: Input buffer contains unsupported image format/);
    assert.equal(failure.code, 9523); assert.equal(failure.reuseCode, 9525);
    const hosted = await fetchLocal('/hosted'); assert.equal(hosted.status, 200); const result = await hosted.json();
    assert.equal(result.uploaded.id, 'libcf-owned-image-probe'); assert.equal(result.initial.filename, 'owned.png'); assert.deepEqual(result.initial.meta, {label:'synthetic'});
    assert.deepEqual(result.bytes, [...png]); assert.equal(result.listing.images.length, 1); assert.equal(result.listing.images[0].id, result.uploaded.id);
    assert.deepEqual(result.filteredOut.images, []);
    assert.deepEqual(result.updated.meta, {phase:'updated'}); assert.equal(result.deleted, true); assert.equal(result.absent, null); assert.equal(result.absentBytes, null);
    assert.deepEqual(result.after.images, []); assert.equal(result.secondDelete, false);
    console.log('native local Images: rotated pixels verified; hosted upload/read/list/update/delete/readback verified', {name:failure.name,code:failure.code,reuseCode:failure.reuseCode,message:failure.message.split('\n')[0]});
  } finally {
    try { await runtime?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
