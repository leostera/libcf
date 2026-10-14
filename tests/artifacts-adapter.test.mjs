import assert from 'node:assert/strict';
import test from 'node:test';
import { performArtifactsInfo as perform } from '../lib/artifacts.mjs';
const empty = new Uint8Array();
const info = () => ({ id: 'repo-id', name: 'owned', defaultBranch: 'main', readOnly: false });
const run = value => perform({ get: () => ({ info: () => value }) }, 'owned', empty, '5000');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0;
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };
  const readOnly = u32(); assert([0, 1].includes(readOnly));
  const result = { readOnly: readOnly === 1 };
  for (const field of ['id', 'name', 'defaultBranch']) {
    const size = u32(); result[field] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + size)); offset += size;
  }
  assert.equal(offset, bytes.length); return result;
}

test('bounded scalar metadata is owned; omitted URL/token/source fields are never traversed', async () => {
  const value = { ...info(), id: '\ufeff猫\0', defaultBranch: 'branch-😀',
    get remote() { assert.fail('remote URL read'); }, get token() { assert.fail('token read'); },
    get description() { assert.fail('description read'); }, get source() { assert.fail('source read'); },
    get createdAt() { assert.fail('timestamp read'); }, get toJSON() { assert.fail('serialization'); } };
  const result = await run(value); assert.equal(result.status, 0);
  value.defaultBranch = 'changed';
  assert.deepEqual(decode(result.bytes), { readOnly: false, id: '\ufeff猫\0', name: 'owned', defaultBranch: 'branch-😀' });
  const name = 'n'.repeat(128);
  const maximum = await perform({ get: () => ({ info: () => ({ id: 'i'.repeat(128), name, defaultBranch: 'b'.repeat(256), readOnly: true }) }) }, name, empty, '60000');
  assert.equal(maximum.bytes.length, 528); assert.equal(decode(maximum.bytes).readOnly, true);
});

test('all input is parsed before capability access', async () => {
  const binding = { get get() { assert.fail('binding touched'); } };
  for (const key of ['', 1, '.', '..', '-repo', 'repo/name', 'repo\n', '猫', 'n'.repeat(129), 'x'.repeat(1048576)])
    await assert.rejects(perform(binding, key, empty, '1'), /invalid Artifacts metadata request/);
  for (const body of [[], new Uint8Array(1)]) await assert.rejects(perform(binding, 'owned', body, '1'), /request/);
  for (const options of [1, '0', '01', '-1', '1\n', '1.5', '60001', '100000'])
    await assert.rejects(perform(binding, 'owned', empty, options), /invalid Artifacts metadata/);
  await assert.rejects(perform(binding, 'owned', empty, '1', {}), /signal/);
  await assert.rejects(perform(binding, 'owned', empty, '1', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, 'owned', empty, '1'), /lookup unavailable/);
  await assert.rejects(perform({ get: () => ({}) }, 'owned', empty, '1'), /info unavailable/);
  for (const name of ['Repo_1.git', '0', 'a-b']) {
    const result = await perform({ get: () => ({ info: () => ({ ...info(), name }) }) }, name, empty, '5000');
    assert.equal(decode(result.bytes).name, name);
  }
});

test('malformed metadata and mismatched repository identity fail without coercion', async () => {
  for (const value of [null, undefined, [], {}, { ...info(), name: 'other' }, { ...info(), readOnly: 1 },
    ...['id', 'defaultBranch'].flatMap(field => ['', null, 1, '\ud800'].map(value => ({ ...info(), [field]: value }))),
    ...[['id', 128], ['defaultBranch', 256]].flatMap(([field, cap]) =>
      ['x'.repeat(cap + 1), '猫'.repeat(Math.floor(cap / 3) + 1)].map(value => ({ ...info(), [field]: value })))])
    await assert.rejects(run(value), /invalid Artifacts metadata/);
});

test('receivers/arguments preserved; four roots held through projection and released in reverse', async () => {
  const released = [], reads = [];
  const disposable = (value, label) => Object.assign(value, { [Symbol.dispose]() { assert.equal(this, value); released.push(label); } });
  const result = disposable({}, 'result');
  for (const [key, value] of Object.entries(info())) Object.defineProperty(result, key, { get() { assert.equal(released.length, 0); reads.push(key); return value; } });
  const pending = disposable(Promise.resolve(result), 'read');
  const repository = disposable({ info(...args) { assert.equal(this, repository); assert.deepEqual(args, []); return pending; } }, 'repository');
  const acquisition = disposable(Promise.resolve(repository), 'acquisition');
  const binding = { get(...args) { assert.equal(this, binding); assert.deepEqual(args, ['owned']); return acquisition; },
    create() { assert.fail('create'); }, list() { assert.fail('list'); }, delete() { assert.fail('delete'); },
    [Symbol.dispose]() { assert.fail('borrowed binding disposed'); } };
  await perform(binding, 'owned', empty, '5000');
  assert.deepEqual(reads, ['id', 'name', 'defaultBranch', 'readOnly']);
  assert.deepEqual(released, ['result', 'read', 'repository', 'acquisition']);
  Object.assign(binding, info()); binding.get = () => binding; binding.info = () => binding;
  await perform(binding, 'owned', empty, '5000');
});

test('aliases release once; cleanup rejects success but does not mask primary errors', async () => {
  let count = 0;
  const alias = { ...info(), info() { return this; }, [Symbol.dispose]() { ++count; } };
  await perform({ get: () => alias }, 'owned', empty, '5000'); assert.equal(count, 1);
  await assert.rejects(run({ ...info(), [Symbol.dispose]() { throw new Error('cleanup'); } }), /cleanup/);
  await assert.rejects(run({ ...info(), id: null, [Symbol.dispose]() { throw new Error('cleanup'); } }), /invalid Artifacts/);
  await assert.rejects(run({ ...info(), [Symbol.dispose]: 1 }), /disposer/);
  const primary = new Error('not found');
  await assert.rejects(perform({ get() { throw primary; } }, 'owned', empty, '5000'), error => error === primary);
  await assert.rejects(perform({ get: () => ({ info() { throw primary; }, [Symbol.dispose]() { throw new Error('cleanup'); } }) }, 'owned', empty, '5000'), error => error === primary);
});

test('cancellation drains either acquisition or read, observing late failures and releasing late roots', async () => {
  for (const stage of ['get', 'info']) for (const mode of ['deadline', 'abort', 'reject']) {
    let resolve, reject, pendingReleases = 0, lateReleases = 0, infoCalls = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending[Symbol.dispose] = () => { ++pendingReleases; };
    const repository = { info() { ++infoCalls; return pending; } };
    const controller = new AbortController();
    const outcome = perform({ get: () => stage === 'get' ? pending : repository }, 'owned', empty, mode === 'deadline' ? '5' : '5000', controller.signal);
    const rejected = assert.rejects(outcome, { name: mode === 'deadline' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode !== 'deadline') controller.abort(); await rejected;
    if (mode === 'reject') reject(new Error('late rejection'));
    else resolve({ ...info(), info() { assert.fail('late repository invoked'); }, [Symbol.dispose]() { ++lateReleases; throw new Error('late cleanup'); } });
    await tick(); assert.equal(infoCalls, stage === 'get' ? 0 : 1);
    assert.equal(pendingReleases, 1); assert.equal(lateReleases, mode === 'reject' ? 0 : 1);
  }
});

test('synchronous abort while acquiring or resolving info releases roots and detaches caller listener', async () => {
  for (const stage of ['get', 'info']) {
    const controller = new AbortController(); let added = 0, removed = 0, released = 0;
    const signal = controller.signal, add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args) => { ++added; return add(...args); };
    signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
    const repository = { get info() { controller.abort(); return () => assert.fail('info called after abort'); }, [Symbol.dispose]() { ++released; } };
    await assert.rejects(perform({ get() { if (stage === 'get') controller.abort(); return repository; } }, 'owned', empty, '5000', signal), { name: 'AbortError' });
    assert.equal(released, 1); assert.equal(added, 1); assert.equal(removed, 1);
  }
});
