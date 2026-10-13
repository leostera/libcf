import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/pipeline/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/pipeline/test/worker.test.mjs');
