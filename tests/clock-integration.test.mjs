import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/build-worker.mjs', 'examples/clock/wrangler.jsonc'], { stdio: 'inherit' });
await import('../examples/clock/test/worker.test.mjs');
