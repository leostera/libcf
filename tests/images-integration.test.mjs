import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/images/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/images/test/worker.test.mjs');
