import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { stat } from 'node:fs/promises';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(label, config) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const start = performance.now();
  const child = spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev',
    '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    let first;
    for (let i = 0; i < 120; ++i) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const before = performance.now();
        const response = await fetch(`${base}/?a=17&b=25`);
        if (response.ok && await response.text() === 'C++: 42') {
          first = { startupMs: performance.now() - start, requestMs: performance.now() - before };
          break;
        }
      } catch { /* Not ready. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!first) throw new Error(`Failed to start ${config}: ${logs}`);
    const samples = [];
    for (let i = 0; i < 130; ++i) {
      const before = performance.now();
      const response = await fetch(`${base}/?a=17&b=25`);
      if (!response.ok || await response.text() !== 'C++: 42') throw new Error(`Bad response: ${logs}`);
      if (i >= 30) samples.push(performance.now() - before);
    }
    console.log(`${label}: startup+first=${first.startupMs.toFixed(1)}ms; first=${first.requestMs.toFixed(2)}ms; median local HTTP=${median(samples).toFixed(2)}ms (100 sequential requests; 30 warmups)`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      let timer;
      try {
        await Promise.race([
          once(child, 'exit'),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Failed to stop: ${logs}`)), 5000); }),
        ]);
      } finally { clearTimeout(timer); }
    }
  }
}

console.log(`Artifact size: C++ glue ${(await stat('build/spike.mjs')).size} bytes, Wasm ${(await stat('build/spike.wasm')).size} bytes, plain JS ${(await stat('examples/hello/plain.mjs')).size} bytes`);
await measure('plain JS', 'examples/hello/plain.wrangler.jsonc');
await measure('C++ Wasm', 'examples/hello/wrangler.jsonc');
