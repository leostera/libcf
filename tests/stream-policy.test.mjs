import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('remote Stream configuration is refused before bundling missing entrypoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-stream-policy-'));
  try {
    for (const remote of [true, 'true', null]) {
      const path = join(directory, 'worker.jsonc');
      await writeFile(path, JSON.stringify({ name: 'stream-policy', main: 'missing.mjs', stream: { binding: 'STREAM', remote } }));
      await assert.rejects(startLocalWorker(path), /Remote Stream is not allowed/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
