import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performQueue } from '../lib/queue.mjs';

test('Queue producer uses a decimal 128-KB exclusive body boundary', async () => {
  for (const method of [112, 113]) {
    let calls = 0;
    const queue = { async send(body, options) {
      calls++;
      assert.equal(body.length, 127_999);
      assert.equal(options.contentType, method === 112 ? 'text' : 'bytes');
      assert.equal(options.delaySeconds, 86400);
    } };
    const accepted = new Uint8Array(127_999).fill(65);
    assert.deepEqual(await performQueue(method, queue, accepted, '86400'), {
      status: 0, bytes: new Uint8Array(),
    });
    for (const length of [128_000, 128 * 1024]) {
      await assert.rejects(performQueue(method, queue, new Uint8Array(length), '0'), /payload/);
    }
    assert.equal(calls, 1);
  }
});

test('Queue rejects invalid delays, UTF-8 and operations before calling a binding', async () => {
  let calls = 0;
  const queue = { async send() { calls++; } };
  for (const delay of ['', '-1', '0.5', '86401', '9007199254740992', 'Infinity']) {
    await assert.rejects(performQueue(113, queue, Uint8Array.of(1), delay));
  }
  await assert.rejects(performQueue(112, queue, Uint8Array.of(255), '0'), /encoded data/);
  await assert.rejects(performQueue(112, queue, new TextEncoder().encode('é'.repeat(64_000)), '0'), /payload/);
  await assert.rejects(performQueue(999, queue, Uint8Array.of(1), '0'), /unknown Queue/);
  assert.equal(calls, 0, 'invalid input must not invoke a binding');
});

test('Queue byte payload is owned before awaiting the binding', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let captured;
  const input = Uint8Array.of(0, 255, 128, 65);
  const result = performQueue(113, { async send(body, options) {
    captured = body;
    assert.deepEqual(options, { contentType: 'bytes', delaySeconds: 0 });
    await pending;
  } }, input, '0');
  input.fill(7);
  assert.deepEqual(captured, Uint8Array.of(0, 255, 128, 65));
  release();
  await result;
});

test('Queue propagates ambiguous provider failure without retrying', async () => {
  let calls = 0;
  const failure = new Error('provider failure');
  await assert.rejects(performQueue(112, { async send() { calls++; throw failure; } },
    new TextEncoder().encode('hello'), '0'), error => error === failure);
  assert.equal(calls, 1);
});
