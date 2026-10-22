import { test } from 'node:test';
import { startLocalWorker } from '../examples/test/local-worker.mjs';
import { ORIGIN_CONFIG, benchmarkCases, correctnessCases, sample } from '../bench/support.mjs';
test('benchmark variants return identical, oracle-checked results for every scenario and edge case', async () => {
  for (const config of ['bench/plain.wrangler.jsonc', 'bench/wrangler.jsonc', 'bench/rust.wrangler.jsonc']) {
    const worker = await startLocalWorker(config, { additionalConfigs: [ORIGIN_CONFIG] });
    try {
      for (const scenario of [...benchmarkCases(), ...correctnessCases()])
        for (let index = 0; index < scenario.payloads.length; index++) await sample(worker.base, scenario, index);
    } finally { await worker.dispose(); }
  }
});
