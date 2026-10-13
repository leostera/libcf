import { test } from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { benchmarkCases, sample } from '../scripts/benchmark-support.mjs';
test('benchmark variants have matching successful HTTP results for every scenario', async () => {
  for (const config of ['examples/benchmark/plain.wrangler.jsonc', 'examples/benchmark/wrangler.jsonc']) {
    const worker = await startLocalWorker(config);
    try { for (const scenario of benchmarkCases()) await sample(worker.base, scenario); }
    finally { await worker.dispose(); }
  }
});
