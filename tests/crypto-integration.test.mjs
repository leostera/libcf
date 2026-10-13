import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/crypto/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/crypto/test/worker.test.mjs');
