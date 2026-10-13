import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

export async function startLocalWorker(config, readyPath = '/') {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const worker = spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev',
    '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  worker.stdout.on('data', chunk => { output += chunk; });
  worker.stderr.on('data', chunk => { output += chunk; });
  async function dispose() {
    if (worker.exitCode !== null || worker.signalCode !== null) return;
    worker.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([
        once(worker, 'exit'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Worker did not stop: ${output}`)), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  try {
    for (let attempt = 0; attempt < 60; ++attempt) {
      if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Worker exited before readiness: ${output}`);
      try {
        // Readiness only requires a response from the Worker, not a specific
        // route status. This lets tests exercise missing routes intentionally.
        await fetch(`${base}${readyPath}`);
        return { base, dispose };
      } catch { /* Worker not listening yet. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Worker readiness timed out: ${output}`);
  } catch (error) {
    await dispose();
    throw error;
  }
}
