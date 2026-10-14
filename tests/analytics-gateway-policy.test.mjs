import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('Analytics SQL and AI/Gateway declarations fail before bundling, even for metadata-only intentions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-analytics-gateway-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    for (const [field, message] of [
      ['analytics', /Analytics SQL queries account data remotely/],
      ['ai', /Workers AI and AI Gateway use remote services/],
    ]) {
      for (const declaration of [null, false, {}, { binding: 'RESOURCE' },
        { binding: 'RESOURCE', remote: false }, { binding: 'RESOURCE', remote: true }]) {
        await writeFile(path, JSON.stringify({ name: 'remote-policy', main: 'missing.mjs', [field]: declaration }));
        await assert.rejects(startLocalWorker(path), message);
      }
      await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), message);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
