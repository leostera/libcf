import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const exec = promisify(execFile);

test('Media live probe forwards auth, bounds native attempts and does not retry a failed frame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-media-probe-'));
  try {
    const tokenFile = join(root, 'probe-token'), preload = join(root, 'mock.mjs');
    const token = 'a'.repeat(64); // Isolated test token, never used against a deployed Worker.
    await writeFile(tokenFile, token, { mode: 0o600 });
    await writeFile(join(root, 'test-deployment.json'), JSON.stringify({
      example: 'media', root, hostname: 'libcf-media-0123456789.libcf.leostera.dev',
    }));
    await writeFile(preload, `
      import assert from 'node:assert/strict';
      let attempts = 0;
      globalThis.fetch = async (url, init) => {
        const target = new URL(url);
        assert.equal(target.origin, 'https://libcf-media-0123456789.libcf.leostera.dev');
        assert.equal(init.redirect, 'error');
        assert(init.signal instanceof AbortSignal);
        const auth = new Headers(init.headers).get('authorization');
        if (auth !== 'Bearer ${token}') return new Response('unauthorized', { status: 401 });
        assert.equal(init.method, 'POST');
        if (target.pathname !== '/frame' || init.body.byteLength === 0)
          return new Response('Media frame failed', { status: 502 });
        ++attempts;
        if (typeof init.body === 'string') return new Response('Media frame failed', { status: 502 });
        assert.equal(init.body.byteLength, 448);
        const png = new Uint8Array(24);
        png.set([137, 80, 78, 71, 13, 10, 26, 10]);
        const view = new DataView(png.buffer);
        view.setUint32(8, 13); png.set(new TextEncoder().encode('IHDR'), 12);
        view.setUint32(16, process.env.LIBCF_BAD_FRAME ? 127 : 128); view.setUint32(20, 128);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      };
      process.once('beforeExit', () => assert.equal(attempts, process.env.LIBCF_BAD_FRAME ? 1 : 3));
    `);
    const args = ['--import', preload, resolve('scripts/test-live-media.mjs'), 'libcf-media-0123456789.libcf.leostera.dev'];
    const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', LIBCF_MEDIA_PROBE_TOKEN_FILE: tokenFile, LIBCF_BAD_FRAME: '' };
    const { stdout, stderr } = await exec(process.execPath, args, { env, timeout: 15000 });
    const report = JSON.parse(stdout);
    assert.equal(report.maxTransformationAttempts, 3);
    assert.equal(report.inputBytes, 448);
    assert.equal(report.pixelContentVerified, false);
    assert.equal(stdout.includes(token), false);
    assert.equal(stderr.includes(token), false);
    await assert.rejects(exec(process.execPath, args, { env: { ...env, LIBCF_BAD_FRAME: '1' }, timeout: 15000 }), { code: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
