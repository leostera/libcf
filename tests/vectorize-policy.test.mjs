import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('local harness rejects a Vectorize index before bundling or runtime startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-vectorize-policy-'));
  try {
    const config = join(root, 'worker.jsonc');
    await writeFile(config, JSON.stringify({
      name: 'libcf-vectorize-policy',
      // Deliberately missing: the remote-binding guard must run before bundling.
      main: 'missing-worker.mjs',
      vectorize: [{ binding: 'INDEX', index_name: 'libcf-vectorize-unused' }],
    }));
    await assert.rejects(startLocalWorker(config), {
      message: 'Vectorize requires a remote index; use an explicit local mock configuration',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
