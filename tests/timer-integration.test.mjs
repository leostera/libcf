import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/timer/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/timer/test/worker.test.mjs');
