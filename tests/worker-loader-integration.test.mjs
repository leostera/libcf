import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/worker-loader/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/worker-loader/test/worker.test.mjs');
