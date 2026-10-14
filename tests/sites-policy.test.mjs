import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('ordinary harness rejects Sites instead of silently dropping its namespace/manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-sites-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    const message = /Legacy Workers Sites requires an explicit manifest\/namespace fixture/;
    for (const site of [null, false, {}, [], { bucket: 'missing-assets' }, { bucket: 'missing-assets', remote: false }]) {
      await writeFile(path, JSON.stringify({ name: 'sites-policy', main: 'missing.mjs', site }));
      await assert.rejects(startLocalWorker(path), message);
      await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), message);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
