import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/rate-limit/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/rate-limit/test/worker.test.mjs');
