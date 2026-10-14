import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('local harness rejects remote Media Transformations before bundling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-media-policy-'));
  try {
    const config = join(root, 'worker.jsonc');
    await writeFile(config, JSON.stringify({ name: 'libcf-media-policy', main: 'missing-worker.mjs', media: { binding: 'MEDIA' } }));
    await assert.rejects(startLocalWorker(config), {
      message: 'Media Transformations use a remote service; use an explicit local mock configuration',
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
