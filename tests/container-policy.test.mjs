import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('Container declarations fail closed before bundling or engine discovery, including additional workers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-container-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    const rejected = /Containers require an explicit local engine\/image and cleanup plan/;
    for (const declaration of [
      { containers: [] }, { containers: null },
      { containers: [{ class_name: 'Box', image: './Dockerfile' }] },
      { containers: [{ class_name: 'Box', images: { base: { reference: 'unapproved:latest' } }, scheduling_policy: 'durable_object' }] },
      { exports: { Box: { type: 'durable-object', storage: 'sqlite', container: 'box' } } },
      { exports: { Box: { type: 'durable-object', container: null } } },
    ]) {
      await writeFile(path, JSON.stringify({ name: 'container-policy', main: 'missing.mjs', ...declaration }));
      // A missing entrypoint would produce a bundler error if the guard ran too late.
      await assert.rejects(startLocalWorker(path), rejected);
    }
    await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), rejected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
