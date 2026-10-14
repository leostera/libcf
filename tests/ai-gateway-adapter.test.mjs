import assert from 'node:assert/strict';
import test from 'node:test';
import { performAiGatewayUrl as perform } from '../lib/ai-gateway.mjs';
const encoder = new TextEncoder(), empty = new Uint8Array();
const prefix = 'https://gateway.ai.cloudflare.com/v1/';
const url = (id = 'owned', provider = '', account = 'synthetic-account') => `${prefix}${account}/${id}/${provider}`;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const run = value => perform({ gateway: () => ({ getUrl: () => value }) }, 'owned', empty, '5000');

test('only gateway/getUrl invoked, receivers and omitted/explicit provider preserved, bytes owned', async () => {
  for (const provider of [undefined, 'universal', 'openai', 'p'.repeat(64)]) {
    const id = 'g'.repeat(64), body = provider === undefined ? empty : encoder.encode(provider), releases = [];
    const endpoint = url(id, !provider || provider === 'universal' ? '' : provider, 'a'.repeat(128));
    const pending = Promise.resolve(endpoint); pending[Symbol.dispose] = () => releases.push('pending');
    const gateway = { getUrl(...args) {
      assert.equal(this, gateway); assert.equal(releases.length, 0);
      assert.deepEqual(args, provider === undefined ? [] : [provider]); return pending;
    }, [Symbol.dispose]() { releases.push('gateway'); }, get run() { assert.fail('inference'); }, get getLog() { assert.fail('logs'); } };
    const acquisition = Promise.resolve(gateway); acquisition[Symbol.dispose] = () => releases.push('acquisition');
    const binding = { gateway(...args) { assert.equal(this, binding); assert.deepEqual(args, [id]); return acquisition; },
      [Symbol.dispose]() { assert.fail('borrowed'); }, get run() { assert.fail('AI inference'); } };
    const outcome = perform(binding, id, body, '60000'); body.fill(0);
    const result = await outcome; assert.equal(result.status, 0); assert.equal(new TextDecoder().decode(result.bytes), endpoint);
    if (provider?.length === 64) assert.equal(result.bytes.length, 295);
    assert.deepEqual(releases, ['pending', 'gateway', 'acquisition']);
  }
  assert.equal(new TextDecoder().decode((await perform({ gateway: () => ({ getUrl: () => url('default') }) }, 'default', empty, '5000')).bytes), url('default'));
});

test('all request validation precedes binding access; no coercion or path injection', async () => {
  const binding = { get gateway() { assert.fail('lookup accessed'); } };
  for (const id of ['', undefined, 1, 'Upper', '-leading', 'a/b', 'a?b', 'a#b', 'a.b', 'a%2fb', 'a\n', '猫', 'x'.repeat(65)]) await assert.rejects(perform(binding, id, empty, '5000'));
  for (const provider of ['Upper', '-leading', 'a/b', 'a?b', 'a.b', 'a\n', '\ufeffopenai', '猫', 'p'.repeat(65)]) await assert.rejects(perform(binding, 'owned', encoder.encode(provider), '5000'));
  for (const body of [[], new Uint8Array([255])]) await assert.rejects(perform(binding, 'owned', body, '5000'));
  for (const options of [1, '', '0', '01', '-1', '1.0', '60001', '1\n']) await assert.rejects(perform(binding, 'owned', empty, options));
  await assert.rejects(perform(binding, 'owned', empty, '5000', {}), /signal/);
  await assert.rejects(perform(binding, 'owned', empty, '5000', AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(perform({}, 'owned', empty, '5000'), /unavailable/);
  await assert.rejects(perform({ gateway: () => null }, 'owned', empty, '5000'), /unavailable/);
});

test('canonical endpoint shape and selector echo, not normalization or fetch authorization', async () => {
  const bad = [null, undefined, {}, new String(url()), '', 'x'.repeat(296),
    url('other'), url('owned', 'openai'), url('owned', '', ''), url('owned', '', 'a'.repeat(129)),
    url('owned', '', '..'), url('owned', '', 'account%2fother'), url('owned', '', 'a\n'),
    url().replace('https:', 'http:'), url().replace('gateway.ai', 'other.ai'), url().replace('https://', 'https://secret@'),
    url().replace('.com/', '.com:443/'), url().replace('/v1/', '/v1//'), url().slice(0, -1), url() + '?key=secret', url() + '#fragment', url() + '\n', url() + '\0'];
  for (const value of bad) await assert.rejects(run(value), /AI Gateway URL/);
  const minimum = await perform({ gateway: () => ({ getUrl: () => url('g', '', 'a') }) }, 'g', empty, '5000');
  assert.equal(minimum.bytes.length, 41);
  let disposed = 0;
  const opaque = { toString() { assert.fail('coercion'); }, toJSON() { assert.fail('serialization'); }, [Symbol.dispose]() { ++disposed; } };
  await assert.rejects(run(opaque), /AI Gateway URL/); assert.equal(disposed, 1);
  // No native account ownership/existence claim follows from this accepted name.
  assert.equal(new TextDecoder().decode((await run(url('owned', '', 'NOT-AN-OWNERSHIP-PROOF'))).bytes), url('owned', '', 'NOT-AN-OWNERSHIP-PROOF'));
});

test('cleanup rejects success, preserves primary failures, deduplicates aliases and excludes borrowed binding', async () => {
  let count = 0;
  const gateway = { getUrl: () => url(), [Symbol.dispose]() { ++count; throw new Error('cleanup'); } };
  await assert.rejects(perform({ gateway: () => gateway }, 'owned', empty, '5000'), /cleanup/); assert.equal(count, 1);
  const primary = new Error('provider failure'); gateway.getUrl = () => { throw primary; };
  await assert.rejects(perform({ gateway: () => gateway }, 'owned', empty, '5000'), error => error === primary); assert.equal(count, 2);
  await assert.rejects(perform({ gateway: () => ({ getUrl: () => url(), [Symbol.dispose]: 1 }) }, 'owned', empty, '5000'), /disposer/);
  const alias = { then(resolve) { delete this.then; resolve(this); }, getUrl: () => url(), [Symbol.dispose]() { ++count; } };
  await perform({ gateway: () => alias }, 'owned', empty, '5000'); assert.equal(count, 3);
  const binding = { gateway() { return this; }, getUrl: () => url(), [Symbol.dispose]() { assert.fail('borrowed'); } };
  await perform(binding, 'owned', empty, '5000');
});

test('abort/deadline at either acquisition/read stage drains late roots without more calls or retries', async () => {
  for (const stage of ['acquisition', 'read']) for (const mode of ['abort', 'timeout', 'reject']) {
    let resolve, reject, reads = 0, disposed = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending[Symbol.dispose] = () => { ++disposed; };
    const gateway = { getUrl() { ++reads; return stage === 'read' ? pending : url(); }, [Symbol.dispose]() { ++disposed; } };
    const controller = new AbortController();
    const outcome = perform({ gateway: () => stage === 'acquisition' ? pending : gateway }, 'owned', empty, mode === 'timeout' ? '5' : '5000', controller.signal);
    const rejected = assert.rejects(outcome, { name: mode === 'timeout' ? 'TimeoutError' : 'AbortError' });
    await tick(); if (mode !== 'timeout') controller.abort(); await rejected;
    if (mode === 'reject') reject(new Error('late rejection'));
    else resolve(stage === 'acquisition' ? gateway : { [Symbol.dispose]() { ++disposed; throw new Error('late cleanup'); } });
    await tick(); assert.equal(reads, stage === 'acquisition' ? 0 : 1);
    assert.equal(disposed, mode === 'reject' ? (stage === 'acquisition' ? 1 : 2) : (stage === 'acquisition' ? 2 : 3));
  }
  const controller = new AbortController(); let reads = 0, disposed = 0, removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { ++removed; return remove(...args); };
  await assert.rejects(perform({ gateway() { controller.abort(); return { getUrl() { ++reads; }, [Symbol.dispose]() { ++disposed; } }; } }, 'owned', empty, '5000', controller.signal), { name: 'AbortError' });
  assert.equal(reads, 0); assert.equal(disposed, 1); assert.equal(removed, 1);
});
