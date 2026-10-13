// Build and run the independent WebSocket example in the default test suite.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)(process.execPath, ['scripts/build-worker.mjs', 'examples/websocket/wrangler.jsonc'], { timeout: 60000 });
await import('../examples/websocket/test/worker.test.mjs');
