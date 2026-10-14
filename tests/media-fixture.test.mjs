import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { syntheticVideo } from '../examples/media/test/video-fixture.mjs';

// Images/Sharp is only an independent local GIF decoder here, not a Media emulator.
test('owned synthetic animated GIF decodes through the pinned local Images implementation', { timeout: 15000 }, async () => {
  const gif = syntheticVideo();
  assert.equal(gif.length, 448);
  assert.deepEqual(gif, syntheticVideo());
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'media-fixture-decoder', compatibilityDate: '2026-10-13', exports: {},
    env: { IMAGES: { type: 'images' } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-media-fixture', modules: {
      'worker.mjs': { type: 'esm', contents: `
        const gif = new Uint8Array(${JSON.stringify([...gif])});
        export default { async fetch(request, env) {
          const image = await env.IMAGES.input(new Response(gif).body).output({ format: 'image/png' });
          return image.response();
        } };
      ` },
    } },
  } }] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const png = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.equal(view.getUint32(16), 16);
    assert.equal(view.getUint32(20), 16);
  } finally { await mf.dispose(); }
});
