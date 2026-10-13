import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/pipeline/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const send = (body, path = '/send') => fetch(`${worker.base}${path}`, { method: 'POST', body });
test('C++ dispatches nested JSON batches to the local no-op binding', async () => {
  const response = await send('[{"event":"fixture","nested":{"flags":[true,false,null]},"value":1.25}]');
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'send completed; sink not verified');
});
test('invalid batches, missing binding and SDK bounds fail with recovery', async () => {
  for (const body of ['not JSON', '{}', '[]', '[null]', '[[1]]', '[{"bad":1e400}]',
    '[{"deep":' + '['.repeat(31) + '0' + ']'.repeat(31) + '}]']) {
    const response = await send(body);
    assert.equal(response.status, 502);
    await response.arrayBuffer();
  }
  assert.equal((await send('[{}]', '/missing')).status, 502);
  assert.equal((await send('', '/oversized')).status, 502);
  assert.equal((await send('[{}]')).status, 202);
});
