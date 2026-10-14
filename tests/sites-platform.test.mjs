import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Pinned runtime capability probe, not a libcf serving implementation or deploy.
test('legacy Sites module import, reads and bounded mutation probes in the pinned runtime', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-sites-'));
  let mf;
  try {
    const assets = join(root, 'owned'); await mkdir(join(assets, 'private'), { recursive: true });
    await writeFile(join(assets, 'index.html'), 'owned Sites fixture');
    await writeFile(join(assets, 'space 猫.bin'), new Uint8Array([0, 255, 1, 128]));
    await writeFile(join(assets, 'private', 'hidden.txt'), 'owned excluded fixture');
    const options = { host: '127.0.0.1', port: 0, workers: [{
      config: { name: 'sites-probe', compatibilityDate: '2026-10-13',
        manifest: { mainModule: 'worker.mjs', modulesRoot: root, modules: { 'worker.mjs': { type: 'esm', contents: `
          import manifestText from '__STATIC_CONTENT_MANIFEST';
          const manifest = JSON.parse(manifestText);
          export default { async fetch(request, env) {
            const path = new URL(request.url).pathname;
            if (path === '/manifest') return Response.json({ manifest, envManifest: typeof env.__STATIC_CONTENT_MANIFEST, globalManifest: typeof globalThis.__STATIC_CONTENT_MANIFEST });
            if (path === '/put' || path === '/delete') {
              // A native KV put against this read-only service did not settle in
              // the initial five-second probe. Report a bounded observation, not
              // successful denial/cancellation when the caller times out.
              let timer;
              try {
                const operation = path === '/put' ? env.__STATIC_CONTENT.put(manifest['index.html'], 'modified') : env.__STATIC_CONTENT.delete(manifest['index.html']);
                const outcome = await Promise.race([
                  operation.then(() => ({ outcome: 'completed' }), error => ({ outcome: 'rejected', message: error.message })),
                  new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'deadline' }), 200); }),
                ]);
                return Response.json(outcome);
              } finally { clearTimeout(timer); }
            }
            const name = path === '/binary' ? 'space 猫.bin' : path === '/excluded' ? 'private/hidden.txt' : path === '/missing' ? 'missing' : 'index.html';
            const value = await env.__STATIC_CONTENT.get(manifest[name] ?? name, 'arrayBuffer');
            return value === null ? new Response('missing', { status: 404 }) : new Response(value);
          } };
        ` } } },
      }, legacy: { sitePath: assets, siteExclude: ['private/**'] },
    }] };
    mf = new Miniflare(options);
    const dispatch = path => mf.dispatchFetch('https://example.test' + path, { signal: AbortSignal.timeout(5000) });
    const manifest = await (await dispatch('/manifest')).json();
    assert.deepEqual(Object.keys(manifest.manifest).sort(), ['index.html', 'space 猫.bin'].sort());
    assert.equal(manifest.envManifest, 'undefined'); assert.equal(manifest.globalManifest, 'undefined');
    assert.equal(manifest.manifest['index.html'], '$__MINIFLARE_SITES__$/index.html');
    assert.equal(manifest.manifest['space 猫.bin'], '$__MINIFLARE_SITES__$/space%20%E7%8C%AB.bin');
    assert.equal(await (await dispatch('/')).text(), 'owned Sites fixture');
    assert.deepEqual(new Uint8Array(await (await dispatch('/binary')).arrayBuffer()), new Uint8Array([0, 255, 1, 128]));
    for (const path of ['/excluded', '/missing']) { const response = await dispatch(path); assert.equal(response.status, 404); await response.arrayBuffer(); }
    for (const path of ['/put', '/delete']) {
      const outcome = await (await dispatch(path)).json();
      assert(['rejected', 'deadline'].includes(outcome.outcome));
      if (outcome.outcome === 'rejected') assert.match(outcome.message, /Cannot (put|delete)\(\) with Workers Sites namespace/);
      console.log('owned local Sites mutation probe', path, outcome);
    }
    assert.equal(await readFile(join(assets, 'index.html'), 'utf8'), 'owned Sites fixture');
    await mf.setOptions({ ...options, workers: [{ ...options.workers[0], legacy: {
      sitePath: assets, siteInclude: ['index.html'], siteExclude: ['index.html'],
    } }] });
    const included = await (await dispatch('/manifest')).json();
    assert.deepEqual(Object.keys(included.manifest), ['index.html']); // Include takes precedence over exclude.
    assert.equal(await (await dispatch('/')).text(), 'owned Sites fixture');
    const excluded = await dispatch('/binary'); assert.equal(excluded.status, 404); await excluded.arrayBuffer();
    await mf.dispose(); mf = undefined;
    assert.equal(await readFile(join(assets, 'index.html'), 'utf8'), 'owned Sites fixture');
  } finally {
    try { await mf?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
