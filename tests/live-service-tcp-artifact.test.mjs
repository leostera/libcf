import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const exec = promisify(execFile);

test('service TCP artifacts expose only an isolated HTTPS client; native connect reference stays private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-service-tcp-artifact-'));
  try {
    const example = join(root, 'examples/service-tcp');
    await mkdir(join(example, 'reference'), { recursive: true });
    const referenceSource = await readFile('examples/service-tcp/reference/worker.mjs', 'utf8');
    await copyFile('examples/service-tcp/reference/worker.mjs', join(example, 'reference/worker.mjs'));
    await writeFile(join(example, 'worker.mjs'), 'import wasm from "./fixture.wasm"; export default { fetch() { return new Response(String(wasm)); } };');
    await writeFile(join(example, 'fixture.wasm'), Buffer.from('0061736d01000000', 'hex'));
    await exec(process.execPath, [resolve('scripts/build-live-worker.mjs'), 'service-tcp'], {
      cwd: root, env: { ...process.env, BUILD_WORKSPACE_DIRECTORY: root }, timeout: 30000,
    });
    const json = async path => JSON.parse(await readFile(path, 'utf8'));
    const deployment = join(root, 'build/live-service-tcp');
    const manifest = await json(join(deployment, 'test-deployment.json'));
    assert.match(manifest.name, /^libcf-service-tcp-[a-f0-9]{10}$/);
    assert.equal(manifest.upstreamName, `${manifest.name}-upstream`);
    assert.equal(manifest.hostname, `${manifest.name}.libcf.leostera.dev`);
    assert.equal(manifest.upstreamHostname, undefined);
    const workers = join(deployment, '.cloudflare/output/v0/workers');
    const frontend = await json(join(workers, 'default/worker.config.json'));
    const reference = await json(join(workers, 'upstream/worker.config.json'));
    assert.deepEqual(frontend.env, { BACKEND: { type: 'worker', worker: manifest.upstreamName } });
    assert.deepEqual(frontend.domains, [manifest.hostname]);
    assert.deepEqual(reference.domains, []);
    assert.equal(reference.env, undefined);
    assert.equal(reference.exports, undefined);
    assert.equal(await readFile(join(workers, 'upstream/bundle/worker.mjs'), 'utf8'), referenceSource);
    for (const config of [frontend, reference]) {
      assert.equal(config.workersDev, false); assert.equal(config.previewUrls, false);
      assert.deepEqual(config.observability, { enabled: true, traces: { enabled: true } });
      assert.equal(config.triggers, undefined);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
