import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Pinned local simulator inspection, not C++ coverage or video processing proof.
test('local Stream lists empty storage but explicitly refuses direct-upload creation', { timeout: 15000 }, async () => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'stream-platform', compatibilityDate: '2026-10-13', exports: {},
    env: { STREAM: { type: 'stream' } },
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-stream-platform', modules: {
      'worker.mjs': { type: 'esm', contents: `
        export default { async fetch(request, env) {
          const videos = env.STREAM.videos;
          const missing = env.STREAM.video('libcf-missing-local-video');
          try {
            const listed = await videos.list({ limit: 1 });
            let uploadFailure, missingFailure;
            try { await env.STREAM.createDirectUpload({ maxDurationSeconds: 1 }); }
            catch (error) { uploadFailure = error.message; }
            try { await missing.details(); }
            catch (error) { missingFailure = error.message; }
            return Response.json({ count: listed.length, uploadFailure, missingFailure });
          } finally {
            missing[Symbol.dispose]?.();
            videos[Symbol.dispose]?.();
          }
        } };
      ` },
    } },
  } }] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.count, 0);
    assert.match(result.uploadFailure, /createDirectUpload is not supported in local mode/);
    assert.match(result.missingFailure, /Video not found/);
  } finally { await mf.dispose(); }
});
