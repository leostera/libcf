import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/workflow/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/workflow/test/worker.test.mjs');
