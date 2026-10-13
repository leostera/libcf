import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/metadata/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/metadata/test/worker.test.mjs');
