import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performWorkflow } from '../lib/workflow.mjs';
const bytes = text => new TextEncoder().encode(text);
const empty = new Uint8Array();
const run = (method, binding, id = 'fixture', body = empty, options = '') => performWorkflow(method, binding, id, body, options);

test('create parses owned JSON params and awaits the provider', async () => {
  let finish;
  let done = false;
  const pending = run(272, { create(input) {
    assert.deepEqual(input, { id: 'fixture', params: { nested: [null, true, '☁'] } });
    return new Promise(resolve => { finish = resolve; });
  } }, 'fixture', bytes('{"nested":[null,true,"☁"]}')).then(value => { done = true; return value; });
  await Promise.resolve();
  assert.equal(done, false);
  finish({ id: 'fixture' });
  assert.deepEqual(await pending, { status: 0, bytes: empty });
  await assert.rejects(run(272, { async create() { return { id: 'other' }; } }, 'fixture', bytes('{}')), /unexpected ID/);
});

test('every known lifecycle state has a distinct wire value; unknown strings reject', async () => {
  const states = ['queued', 'running', 'paused', 'errored', 'terminated', 'complete', 'waiting', 'waitingForPause', 'rollingBack', 'unknown'];
  for (const [index, status] of states.entries()) {
    const result = await run(273, { async get(id) { return { id, async status() { return { status, output: 'not exposed by this operation' }; } }; } });
    assert.deepEqual(result.bytes, new Uint8Array([index]));
  }
  await assert.rejects(run(273, { async get(id) { return { id, async status() { return { status: 'future-state' }; } }; } }), /invalid workflow state/);
  await assert.rejects(run(273, { async get() { return { id: 'other' }; } }), /unexpected ID/);
});

test('erase awaits deletion; missing instances and provider failures propagate', async () => {
  let finish;
  let deleted = false;
  const pending = run(274, { async get(id) { return { id, delete() { return new Promise(resolve => { finish = resolve; }); } }; } });
  pending.then(() => { deleted = true; });
  await Promise.resolve();
  assert.equal(deleted, false);
  finish();
  assert.deepEqual(await pending, { status: 0, bytes: empty });
  await assert.rejects(run(274, { async get() { throw new Error('missing instance'); } }), /missing instance/);
  await assert.rejects(run(274, { async get(id) { return { id, async delete() { throw new Error('delete failed'); } }; } }), /delete failed/);
});

test('invalid command boundaries fail before creation or lookup', async () => {
  let calls = 0;
  const binding = { create() { calls++; }, get() { calls++; } };
  for (const id of ['', '-bad', 'bad space', 'bad\n', '☁', 'a'.repeat(101)]) {
    await assert.rejects(run(272, binding, id, bytes('{}')));
    await assert.rejects(run(273, binding, id));
    await assert.rejects(run(274, binding, id));
  }
  for (const input of ['[]', 'null', '0', '', 'invalid', '{"x":1e400}'])
    await assert.rejects(run(272, binding, 'fixture', bytes(input)));
  await assert.rejects(run(272, binding, 'fixture', new Uint8Array([255])));
  await assert.rejects(run(272, binding, 'fixture', new Uint8Array(1048577)));
  await assert.rejects(run(273, binding, 'fixture', bytes('{}')));
  await assert.rejects(run(274, binding, 'fixture', empty, 'unexpected'));
  await assert.rejects(run(999, binding));
  assert.equal(calls, 0);
});
