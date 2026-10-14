import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';

test('bounded Sites adapter reads native local streams through the imported manifest', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-sites-adapter-'));
  let mf;
  try {
    const assets = join(root, 'assets'); await mkdir(assets);
    for (const [name, contents] of [
      ['owned.txt', 'owned Sites read'], ['space 猫.bin', new Uint8Array([0, 255, 128])], ['empty.bin', new Uint8Array()],
      ['maximum.bin', new Uint8Array(1048576).fill(7)], ['oversized.bin', new Uint8Array(1048577)], ['hidden.txt', 'excluded'],
    ]) await writeFile(join(assets, name), contents);
    const modules = {};
    for (const name of ['sites', 'json', 'body']) modules[name + '.mjs'] = { type: 'esm', contents: await readFile(new URL('../lib/' + name + '.mjs', import.meta.url), 'utf8') };
    modules['worker.mjs'] = { type: 'esm', contents: `
      import manifestText from '__STATIC_CONTENT_MANIFEST';
      import { parseSitesManifest, performSitesGet } from './sites.mjs';
      const manifest = parseSitesManifest(manifestText);
      export default { async fetch(request, env) {
        try {
          const key = await request.text();
          const reply = await performSitesGet(env.__STATIC_CONTENT, manifest, key, new Uint8Array(), '5000');
          return new Response(reply.bytes, { status: reply.status === 1 ? 404 : 200 });
        } catch (error) { return new Response(error.message, { status: 502 }); }
      } };
    ` };
    mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{
      config: { name: 'sites-adapter', compatibilityDate: '2026-10-13', manifest: { mainModule: 'worker.mjs', modulesRoot: join(root, 'modules'), modules } },
      legacy: { sitePath: assets, siteExclude: ['hidden.txt'] },
    }] });
    const get = body => mf.dispatchFetch('https://example.test/', { method: 'POST', body, signal: AbortSignal.timeout(7000) });
    const read = await get('owned.txt'); assert.equal(read.status, 200); assert.equal(await read.text(), 'owned Sites read');
    const binary = await get('space 猫.bin'); assert.equal(binary.status, 200); assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), new Uint8Array([0, 255, 128]));
    const empty = await get('empty.bin'); assert.equal(empty.status, 200); assert.equal((await empty.arrayBuffer()).byteLength, 0);
    await Promise.all(Array.from({ length: 8 }, async () => {
      const response = await get('owned.txt'); assert.equal(response.status, 200); assert.equal(await response.text(), 'owned Sites read');
    }));
    const maximum = await get('maximum.bin'); assert.equal(maximum.status, 200);
    const maximumBytes = new Uint8Array(await maximum.arrayBuffer()); assert.equal(maximumBytes.length, 1048576); assert(maximumBytes.every(byte => byte === 7));
    const oversized = await get('oversized.bin'); assert.equal(oversized.status, 502); assert.match(await oversized.text(), /body exceeds limit/);
    for (const key of ['missing', 'hidden.txt', 'constructor', '__proto__']) { const response = await get(key); assert.equal(response.status, 404); await response.arrayBuffer(); }
    for (const key of ['../owned.txt', '/owned.txt', 'space%20猫.bin', 'owned.txt?x']) { const response = await get(key); assert.equal(response.status, 502); await response.arrayBuffer(); }
    await unlink(join(assets, 'owned.txt')); // Manifest still contains the now-missing physical file.
    const stale = await get('owned.txt'); assert.equal(stale.status, 404); await stale.arrayBuffer();
    const recovery = await get('empty.bin'); assert.equal(recovery.status, 200); await recovery.arrayBuffer();
  } finally {
    try { await mf?.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
