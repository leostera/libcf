import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parseInstancePage, waitForInstanceReadback } from '../scripts/workflow-instance-readback.mjs';
const wire = ids => JSON.stringify(ids.map(id => ({ id })));
const options = phase => ({ phase, signal: AbortSignal.timeout(1000), retryMs: 1 });

test('instance page parser produces unique bounded identities, not unchecked CLI objects', () => {
  assert.deepEqual([...parseInstancePage(wire(['a', '_b-1']))], ['a', '_b-1']);
  assert.equal(parseInstancePage(wire([])).size, 0);
  assert.equal(parseInstancePage(wire(['a'.repeat(100)])).size, 1);
  for (const invalid of ['{}', 'null', '[null]', '[{}]', wire(['a', 'a']), wire(['a\n']),
    wire(['-a']), wire(['a'.repeat(101)]), wire(Array.from({ length: 101 }, (_, i) => `id-${i}`))])
    assert.throws(() => parseInstancePage(invalid));
});

test('requires all owned instances present before accepting an empty deletion readback', async () => {
  let index = 0;
  const pages = [[], ['a'], ['b', 'a']];
  assert.deepEqual(await waitForInstanceReadback(async () => wire(pages[index++]), ['a', 'b'], options('present')), ['b', 'a']);
  assert.equal(index, 3);
  index = 0;
  const deleting = [['a', 'b'], ['b'], []];
  assert.deepEqual(await waitForInstanceReadback(async () => wire(deleting[index++]), ['a', 'b'], options('absent')), []);
  assert.equal(index, 3);
});

test('an always-empty listing cannot establish presence and never retries mutations', async () => {
  let reads = 0;
  await assert.rejects(waitForInstanceReadback(async () => { reads++; return '[]'; }, ['a'],
    { phase: 'present', signal: AbortSignal.timeout(20), retryMs: 1 }));
  assert(reads > 0);
});

test('unexpected or duplicate instances reject, even during deletion polling', async () => {
  for (const ids of [['foreign'], ['a', 'a']])
    await assert.rejects(waitForInstanceReadback(async () => wire(ids), ['a'], options('absent')));
});

test('cancellation reaches an in-flight query and a pre-aborted read does not query', async () => {
  const signal = AbortSignal.timeout(20);
  await assert.rejects(waitForInstanceReadback(async received => {
    assert.equal(received, signal);
    return delay(10000, '[]', { signal: received });
  }, ['a'], { phase: 'present', signal, retryMs: 1 }));
  let called = false;
  await assert.rejects(waitForInstanceReadback(async () => { called = true; return '[]'; }, ['a'],
    { phase: 'absent', signal: AbortSignal.abort(), retryMs: 1 }));
  assert.equal(called, false);
});

test('invalid polling configuration rejects before querying', async () => {
  for (const overrides of [{ phase: 'other' }, { signal: undefined }, { retryMs: 0 }, { retryMs: Infinity }]) {
    await assert.rejects(waitForInstanceReadback(async () => assert.fail('queried'), ['a'],
      { ...options('present'), ...overrides }));
  }
  await assert.rejects(waitForInstanceReadback(async () => assert.fail('queried'), [], options('present')));
});
