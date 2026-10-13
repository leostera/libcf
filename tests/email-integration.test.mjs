// Build and run the isolated email simulator; no real mail is sent.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/email/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/email/test/worker.test.mjs');
