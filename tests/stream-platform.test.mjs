import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createServer } from 'node:http';
import { syntheticVideo } from '../examples/media/test/video-fixture.mjs';

// Pinned local simulator inspection, not C++ coverage or video processing proof.
// All fixture bytes and HTTP ingress below are owned, local and synthetic.
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

test('local Stream URL fixture supports scoped metadata reads and independent deletion readback, not transcoding', { timeout: 15000 }, async () => {
  const bytes = syntheticVideo();
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/owned.gif') {
      response.writeHead(404); response.end(); return;
    }
    ++requests;
    response.writeHead(200, { 'content-type': 'image/gif', 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let mf;
  try {
    const source = `http://127.0.0.1:${server.address().port}/owned.gif`;
    mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
      name: 'stream-metadata-platform', compatibilityDate: '2026-10-13', exports: {},
      env: { STREAM: { type: 'stream' } },
      manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-stream-metadata-platform', modules: {
        'worker.mjs': { type: 'esm', contents: `
          export default { async fetch(request, env) {
            const disposed = new WeakSet();
            function release(...values) {
              for (const value of values) {
                if (value === env.STREAM || value === null || !['object', 'function'].includes(typeof value) || disposed.has(value)) continue;
                disposed.add(value);
                value[Symbol.dispose]?.();
              }
            }
            let retiredCollection, retiredVideo;
            async function list() {
              const pending = env.STREAM.videos;
              let handle, call, value;
              try {
                handle = await pending; retiredCollection = handle;
                call = handle.list({ limit: 1 }); value = await call;
                return value.map(video => video.id);
              } finally { release(value, call, handle, pending); }
            }
            async function details(id) {
              const pending = env.STREAM.video(id);
              let handle, call, value;
              try {
                handle = await pending; retiredVideo = handle;
                call = handle.details(); value = await call;
                return { id: value.id, size: value.size, duration: value.duration,
                  state: value.status.state, ready: value.readyToStream,
                  width: value.input.width, height: value.input.height,
                  createdType: typeof value.created, modifiedType: typeof value.modified };
              } finally { release(value, call, handle, pending); }
            }
            async function remove(id) {
              const pending = env.STREAM.video(id);
              let handle, call;
              try { handle = await pending; call = handle.delete(); await call; }
              finally { release(call, handle, pending); }
            }
            const before = await list();
            let id, summary, listed, disposedCollection, disposedVideo;
            let upload, uploaded;
            try {
              // Public URL argument shape, but only a local fixture fetch. No raw-stream extension.
              upload = env.STREAM.upload(${JSON.stringify(source)}, { creator: 'libcf-local-fixture' });
              uploaded = await upload; id = uploaded.id;
              summary = await details(id); listed = await list();
              try { await retiredCollection.list({ limit: 1 }); disposedCollection = 'unexpected success'; }
              catch (error) { disposedCollection = error.message; }
              try { await retiredVideo.details(); disposedVideo = 'unexpected success'; }
              catch (error) { disposedVideo = error.message; }
            } finally {
              try { if (id) await remove(id); }
              finally { release(uploaded, upload); }
            }
            let missing;
            try { await details(id); missing = 'unexpected success'; }
            catch (error) { missing = error.message; }
            // Fresh collection lookup also proves the borrowed binding remains usable.
            const after = await list();
            return Response.json({ before, summary, listed, after, missing, disposedCollection, disposedVideo });
          } };
        ` },
      } },
    } }] });
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.before, []);
    assert.deepEqual(result.listed, [result.summary.id]);
    assert.match(result.summary.id, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.deepEqual(result.summary, { id: result.summary.id, size: 448, duration: -1,
      state: 'ready', ready: true, width: 0, height: 0, createdType: 'string', modifiedType: 'string' });
    assert.match(result.disposedCollection, /disposed/i);
    assert.match(result.disposedVideo, /disposed/i);
    assert.match(result.missing, /Video not found/);
    assert.deepEqual(result.after, []);
    assert.equal(requests, 1);
  } finally {
    try { await mf?.dispose(); }
    finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
