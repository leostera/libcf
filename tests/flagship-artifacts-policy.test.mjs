import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('unmapped Flagship and remote Artifacts declarations cannot silently disappear from local tests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-flagship-artifacts-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    for (const [family, message, binding] of [
      ['artifacts', /Artifacts uses a remote service/, { binding: 'ARTIFACTS', namespace: 'owned-only', remote: false }],
      ['flagship', /Flagship requires explicit local seeding/, { binding: 'FLAGS', app_id: 'owned-only', remote: false }],
    ]) {
      for (const declaration of [null, [], [binding], [{ ...binding, remote: true }]]) {
        await writeFile(path, JSON.stringify({ name: 'binding-policy', main: 'missing.mjs', [family]: declaration }));
        // Reject before bundling; this intentionally has no usable entrypoint.
        await assert.rejects(startLocalWorker(path), message);
      }
      await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), message);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
