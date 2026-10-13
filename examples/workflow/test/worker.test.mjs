import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/workflow/wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
async function call(path, method = 'GET', body) {
  const response = await fetch(`${worker.base}${path}`, { method, body });
  return { status: response.status, text: await response.text() };
}
async function awaitState(id, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await call(`/state/${id}`);
    assert.equal(result.status, 200);
    if (result.text === expected) return;
    assert(['queued', 'running', 'waiting'].includes(result.text), result.text);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`workflow did not reach ${expected}`);
}
test('C++ creates, observes and deletes a JS workflow with parameter readback', async () => {
  const params = { message: 'fixture', nested: { values: [null, true, 1.25] } };
  assert.equal((await call('/create/echo', 'POST', JSON.stringify(params))).status, 201);
  await awaitState('echo', 'complete');
  const output = await call('/fixture-output?id=echo');
  assert.deepEqual(JSON.parse(output.text), params);
  assert.equal((await call('/create/echo', 'POST', '{}')).status, 502);
  assert.equal((await call('/delete/echo', 'DELETE')).status, 200);
  assert.equal((await call('/state/echo')).status, 502);
});
test('deleting an active instance removes its stored state', async () => {
  assert.equal((await call('/create/waiting', 'POST', '{"wait":true}')).status, 201);
  // The pinned emulator keeps this event-waiting workflow in running state;
  // it does not establish the production hibernation transition to waiting.
  await awaitState('waiting', 'running');
  assert.equal((await call('/delete/waiting', 'DELETE')).status, 200);
  assert.equal((await call('/state/waiting')).status, 502);
});
test('invalid IDs/params, missing bindings and missing instances fail without creation', async () => {
  for (const id of ['-bad', 'a'.repeat(101)])
    assert.equal((await call(`/create/${id}`, 'POST', '{}')).status, 502);
  for (const body of ['[]', 'null', 'not JSON', '{"x":1e400}'])
    assert.equal((await call('/create/invalid', 'POST', body)).status, 502);
  assert.equal((await call('/state/invalid')).status, 502);
  assert.equal((await call('/missing/missing', 'POST', '{}')).status, 502);
  assert.equal((await call('/delete/absent', 'DELETE')).status, 502);
});
