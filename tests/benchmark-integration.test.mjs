import { test } from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { benchmarkCases, sample } from '../bench/support.mjs';
test('benchmark variants have matching successful HTTP results for every scenario', async () => {
  for (const config of ['bench/plain.wrangler.jsonc', 'bench/wrangler.jsonc', 'bench/rust.wrangler.jsonc']) {
    const worker = await startLocalWorker(config);
    try { for (const scenario of benchmarkCases()) await sample(worker.base, scenario); }
    finally { await worker.dispose(); }
  }
});
