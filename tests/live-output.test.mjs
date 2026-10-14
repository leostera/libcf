import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveOutput } from '../scripts/live-output.mjs';

test('live preparation uses an explicit workspace and cannot replace ownership records', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'libcf-live-output-'));
  try {
    const root = await createLiveOutput('rpc', workspace);
    assert.equal(root, join(workspace, 'build/live-rpc'));
    const manifest = join(root, 'test-deployment.json');
    await writeFile(manifest, 'retained ownership evidence');
    await assert.rejects(createLiveOutput('rpc', workspace), { code: 'EEXIST' });
    assert.equal(await readFile(manifest, 'utf8'), 'retained ownership evidence');
    assert.deepEqual(await readdir(root), ['test-deployment.json']);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('concurrent preparations get one directory owner; invalid families have no side effects', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'libcf-live-exclusive-'));
  try {
    for (const family of ['', '..', '../rpc', 'a/b', 'x'.repeat(33), undefined]) {
      await assert.rejects(createLiveOutput(family, workspace), /Invalid live output family/);
    }
    assert.deepEqual(await readdir(workspace), []);
    const attempts = await Promise.allSettled([
      createLiveOutput('clock', workspace), createLiveOutput('clock', workspace),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.code === 'EEXIST').length, 1);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
