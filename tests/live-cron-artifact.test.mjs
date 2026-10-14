import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);

async function fixture(alias, check) {
  const root = await mkdtemp(join(tmpdir(), 'libcf-cron-artifact-'));
  try {
    const source = join(root, 'source');
    const workspace = join(root, 'workspace');
    await mkdir(join(source, 'examples/events'), { recursive: true });
    await mkdir(join(source, 'build'));
    await mkdir(join(workspace, 'build'), { recursive: true });
    await writeFile(join(source, 'examples/events/cron-control.mjs'), 'export default { async scheduled() {} };');
    await writeFile(join(source, 'examples/events/worker.mjs'),
      'import wasm from "../../build/events.wasm"; export default { fetch() { return new Response(String(wasm)); } };');
    const wasm = Buffer.from('0061736d01000000', 'hex');
    await writeFile(join(source, 'build/events.wasm'), wasm);
    await symlink(join(source, 'examples'), join(workspace, 'examples'), 'dir');
    if (alias) await symlink(join(source, 'build/events.wasm'), join(workspace, 'build/events.wasm'));
    else await writeFile(join(workspace, 'build/events.wasm'), wasm);
    const run = () => exec(process.execPath, [resolve('scripts/build-live-cron-control.mjs'),
      '00000000-0000-0000-0000-000000000002'], {
      cwd: workspace, env: { ...process.env, BUILD_WORKSPACE_DIRECTORY: workspace }, timeout: 30000,
    });
    await check(run, join(workspace, 'build/live-cron-control'), wasm);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('Cron preparation accepts runfile aliases of the declared Wasm artifact', async () => {
  await fixture(true, async (run, output, wasm) => {
    await run();
    const manifest = JSON.parse(await readFile(join(output, 'test-deployment.json'), 'utf8'));
    assert.equal(manifest.workers.length, 2);
    for (const role of ['default', 'cpp']) {
      const directory = join(output, '.cloudflare/output/v0/workers', role);
      const config = JSON.parse(await readFile(join(directory, 'worker.config.json'), 'utf8'));
      assert.deepEqual(config.domains, []);
      assert.equal(config.workersDev, false); assert.equal(config.previewUrls, false);
      assert.deepEqual(config.triggers, [{ type: 'scheduled', schedule: '* * * * *' }]);
      if (role === 'cpp') assert.deepEqual(await readFile(join(directory, 'bundle/events.wasm')), wasm);
    }
  });
});

test('Cron preparation rejects another Wasm file even with the same name and bytes', async () => {
  await fixture(false, async run => {
    await assert.rejects(run(), error => /Unexpected Wasm import/.test(error.stderr));
  });
});
