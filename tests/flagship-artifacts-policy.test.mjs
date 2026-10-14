import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('remote Artifacts and non-explicit or malformed Flagship fixtures fail before bundling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-flagship-artifacts-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    const local = { binding: 'FLAGS', app_id: 'owned-only', remote: false };
    const cases = [
      ['artifacts', /Artifacts uses a remote service/, [null, [],
        [{ binding: 'ARTIFACTS', namespace: 'owned-only', remote: false }],
        [{ binding: 'ARTIFACTS', namespace: 'owned-only', remote: true }]]],
      ['flagship', /Flagship requires explicit local seeding/, [null, [], {}, [null],
        [{ binding: 'FLAGS', app_id: 'owned-only' }],
        ...[true, null, 'false', 0].map(remote => [{ ...local, remote }]),
        ...['', 'bad\n', '__proto__', 'f'.repeat(65), 1].map(binding => [{ ...local, binding }]),
        ...['', 'bad\n', 'bad/id', 'a'.repeat(129), 1].map(app_id => [{ ...local, app_id }]),
        [{ ...local, unknown: true }], [local, local]]],
    ];
    for (const [family, message, declarations] of cases) {
      for (const declaration of declarations) {
        await writeFile(path, JSON.stringify({ name: 'binding-policy', main: 'missing.mjs', [family]: declaration }));
        // Reject before bundling; this intentionally has no usable entrypoint.
        await assert.rejects(startLocalWorker(path), message);
      }
      await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), message);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
