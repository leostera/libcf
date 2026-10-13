import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const exec = promisify(execFile);

test('HTTP live artifacts isolate both origins and expose no workers.dev or previews', async () => {
  // A temporary source tree prevents default tests from replacing an active
  // deployment manifest. This checks packaging, not C++ execution.
  const root = await mkdtemp(join(tmpdir(), 'libcf-http-artifact-'));
  try {
    const example = join(root, 'examples/http-client');
    await mkdir(join(example, 'upstream'), { recursive: true });
    await mkdir(join(root, 'lib'));
    await copyFile('lib/body.mjs', join(root, 'lib/body.mjs'));
    await copyFile('examples/http-client/upstream/worker.mjs', join(example, 'upstream/worker.mjs'));
    await writeFile(join(example, 'worker.mjs'), 'import wasm from "./fixture.wasm"; export default { fetch() { return new Response(String(wasm)); } };');
    await writeFile(join(example, 'fixture.wasm'), Buffer.from('0061736d01000000', 'hex'));
    await exec(process.execPath, [resolve('scripts/build-live-worker.mjs'), 'http-client'], { cwd: root, timeout: 30000 });
    const deploymentRoot = join(root, 'build/live-http-client');
    const json = async path => JSON.parse(await readFile(path, 'utf8'));
    const manifest = await json(join(deploymentRoot, 'test-deployment.json'));
    assert.match(manifest.name, /^libcf-http-client-[a-f0-9]{10}$/);
    assert.equal(manifest.upstreamName, manifest.name.replace('http-client', 'http-upstream'));
    assert.equal(manifest.hostname, `${manifest.name}.libcf.leostera.dev`);
    assert.equal(manifest.upstreamHostname, `${manifest.upstreamName}.libcf.leostera.dev`);
    const workers = join(deploymentRoot, '.cloudflare/output/v0/workers');
    for (const [key, name, hostname] of [['default', manifest.name, manifest.hostname], ['upstream', manifest.upstreamName, manifest.upstreamHostname]]) {
      const config = await json(join(workers, key, 'worker.config.json'));
      assert.equal(config.name, name);
      assert.equal(config.workersDev, false);
      assert.equal(config.previewUrls, false);
      assert.equal(config.compatibilityDate, '2026-10-13');
      assert.deepEqual(config.domains, [hostname]);
      assert.equal(config.observability.traces.enabled, true);
      if (key === 'default') {
        assert.deepEqual(config.env, { UPSTREAM_URL: { type: 'text', value: `https://${manifest.upstreamHostname}` } });
        assert.deepEqual(config.compatibilityFlags, ['global_fetch_strictly_public']);
      } else assert.equal(config.env, undefined);
    }
    const source = await readFile(join(workers, 'upstream/bundle/worker.mjs'), 'utf8');
    assert.match(source, /function readBounded/);
    assert.doesNotMatch(source, /import .*body\.mjs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
