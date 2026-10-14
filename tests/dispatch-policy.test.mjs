import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('local harness rejects dispatch namespaces before bundling or runtime startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'libcf-dispatch-policy-'));
  try {
    const config = join(root, 'worker.jsonc');
    await writeFile(config, JSON.stringify({
      name: 'libcf-dispatch-policy',
      main: 'missing-worker.mjs',
      dispatch_namespaces: [{ binding: 'DISPATCHER', namespace: 'libcf-unused', remote: true }],
    }));
    await assert.rejects(startLocalWorker(config), {
      message: 'Dispatch namespaces require remote Workers for Platforms; use an explicit local mock configuration',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
