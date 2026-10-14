import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('Browser config cannot silently enable remote usage or undeclared Chrome before local bundling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-browser-policy-'));
  try {
    for (const remote of [undefined, false, true]) {
      const path = join(directory, 'worker.jsonc');
      await writeFile(path, JSON.stringify({ name: 'browser-policy', main: 'missing.mjs', browser: { binding: 'BROWSER', remote } }));
      await assert.rejects(startLocalWorker(path), /Browser Run requires an explicit local mock/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
