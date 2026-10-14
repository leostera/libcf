import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

const configs = {
  ai_search: [{ binding: 'SEARCH', instance_name: 'libcf-unused' }],
  ai_search_namespaces: [{ binding: 'SEARCH', namespace: 'libcf-unused' }],
  agent_memory: [{ binding: 'MEMORY', namespace: 'libcf-unused' }],
};
for (const [key, value] of Object.entries(configs)) {
  test(`${key} fails before local bundling/runtime rather than enabling a remote proxy`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'libcf-search-policy-'));
    try {
      const config = join(root, 'worker.jsonc');
      await writeFile(config, JSON.stringify({ name: 'libcf-search-policy', main: 'missing-worker.mjs', [key]: value }));
      await assert.rejects(startLocalWorker(config), {
        message: 'AI Search and Agent Memory use remote services; use an explicit local mock configuration',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
