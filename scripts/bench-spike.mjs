import { performance } from 'node:perf_hooks';
import { stat } from 'node:fs/promises';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(label, config) {
  const start = performance.now();
  const worker = await startLocalWorker(config);
  const startup = performance.now() - start;
  try {
    const samples = [];
    for (let i = 0; i < 130; ++i) {
      const before = performance.now();
      const response = await fetch(`${worker.base}/?a=17&b=25`);
      if (!response.ok || await response.text() !== 'C++: 42') throw new Error(`Bad response from ${label}`);
      if (i >= 30) samples.push(performance.now() - before);
    }
    console.log(`${label}: bundle+runtime+readiness=${startup.toFixed(1)}ms; median local HTTP=${median(samples).toFixed(2)}ms (100 sequential requests; 30 warmups)`);
  } finally {
    await worker.dispose();
  }
}

console.log('Local harness timings include esbuild/workerd startup; they are not production cold-start or isolated ABI measurements.');
console.log(`Artifact size: C++ glue ${(await stat('build/spike.mjs')).size} bytes, Wasm ${(await stat('build/spike.wasm')).size} bytes, plain JS ${(await stat('examples/hello/plain.mjs')).size} bytes`);
await measure('plain JS', 'examples/hello/plain.wrangler.jsonc');
await measure('C++ Wasm', 'examples/hello/wrangler.jsonc');
