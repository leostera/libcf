import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const exec = promisify(execFile);

test('Media preparation deploys only a token hash and leaves the fresh token in a private local file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-media-artifact-'));
  try {
    const example = join(root, 'examples/media');
    await mkdir(example, { recursive: true });
    await copyFile('examples/media/auth.mjs', join(example, 'auth.mjs'));
    await writeFile(join(example, 'worker.mjs'), 'import wasm from "./fixture.wasm"; import { authenticatedMediaWorker } from "./auth.mjs"; export default authenticatedMediaWorker({ fetch() { return new Response(String(wasm)); } });');
    await writeFile(join(example, 'fixture.wasm'), Buffer.from('0061736d01000000', 'hex'));
    const { stdout, stderr } = await exec(process.execPath, [resolve('scripts/build-live-worker.mjs'), 'media'], {
      cwd: root, env: { ...process.env, BUILD_WORKSPACE_DIRECTORY: root }, timeout: 30000,
    });
    const output = join(root, 'build/live-media');
    const token = await readFile(join(output, 'probe-token'), 'utf8');
    assert.equal(token.length, 64);
    assert.equal((await stat(join(output, 'probe-token'))).mode & 0o077, 0);
    const manifestText = await readFile(join(output, 'test-deployment.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.match(manifest.name, /^libcf-media-[a-f0-9]{10}$/);
    const directory = join(output, '.cloudflare/output/v0/workers/default');
    const configText = await readFile(join(directory, 'worker.config.json'), 'utf8');
    const config = JSON.parse(configText);
    assert.deepEqual(config.env, { MEDIA: { type: 'media' }, LIBCF_MEDIA_PROBE_SHA256: {
      type: 'text', value: createHash('sha256').update(token).digest('hex'),
    } });
    assert.deepEqual(config.domains, [`${manifest.name}.libcf.leostera.dev`]);
    assert.equal(config.workersDev, false);
    assert.equal(config.previewUrls, false);
    assert.equal(config.triggers, undefined);
    const bundle = await readFile(join(directory, 'bundle/worker.mjs'), 'utf8');
    assert.match(bundle, /timingSafeEqual/);
    for (const text of [stdout, stderr, manifestText, configText, bundle]) assert.equal(text.includes(token), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
