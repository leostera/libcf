import { startLocalWorker } from '../examples/test/local-worker.mjs';

const example = process.argv[2];
if (!['hello', 'core', 'kv', 'd1', 'r2', 'cache', 'service', 'durable', 'events'].includes(example))
  throw new Error('Choose hello, core, kv, d1, r2, cache, service, durable or events; build it first.');
const worker = await startLocalWorker(`examples/${example}/wrangler.jsonc`, {
  additionalConfigs: example === 'service' ? ['examples/service/upstream/wrangler.jsonc'] : [],
});
console.log(`Local ${example}: ${worker.base} (Miniflare/workerd; no remote resources)`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.dispose();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
