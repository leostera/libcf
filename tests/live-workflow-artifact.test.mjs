import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const exec = promisify(execFile);

test('Workflow live artifact uses an isolated same-worker definition and binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-workflow-artifact-'));
  try {
    const example = join(root, 'examples/workflow');
    await mkdir(example, { recursive: true });
    await writeFile(join(example, 'worker.mjs'), 'export class FixtureWorkflow {} export default { fetch() { return new Response("fixture"); } };');
    await exec(process.execPath, [resolve('scripts/build-live-worker.mjs'), 'workflow'], { cwd: root, timeout: 30000 });
    const deployment = join(root, 'build/live-workflow');
    const manifest = JSON.parse(await readFile(join(deployment, 'test-deployment.json'), 'utf8'));
    assert.match(manifest.name, /^libcf-workflow-[a-f0-9]{10}$/);
    assert.equal(manifest.workflowName, manifest.name);
    const config = JSON.parse(await readFile(join(deployment, '.cloudflare/output/v0/workers/default/worker.config.json'), 'utf8'));
    assert.equal(config.name, manifest.name);
    assert.equal(config.workersDev, false);
    assert.equal(config.previewUrls, false);
    assert.equal(config.compatibilityDate, '2026-10-13');
    assert.deepEqual(config.domains, [`${manifest.name}.libcf.leostera.dev`]);
    assert.deepEqual(config.env, { FLOW: { type: 'workflow', name: manifest.workflowName, worker: manifest.name, exportName: 'FixtureWorkflow' } });
    assert.deepEqual(config.exports, { FixtureWorkflow: { type: 'workflow', name: manifest.workflowName } });
    assert.equal(config.triggers, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
