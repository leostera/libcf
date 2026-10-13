import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { performDigest } from '../lib/subtle-crypto.mjs';

test('Web Crypto hashes exactly the provided byte view for each SHA-2 size', async () => {
  const input = new Uint8Array([99, 0, 255, 1, 99]).subarray(1, 4);
  for (const algorithm of ['SHA-256', 'SHA-384', 'SHA-512']) {
    const result = await performDigest(algorithm, input, crypto.subtle);
    assert.equal(result.status, 0);
    assert.equal(Buffer.from(result.bytes).toString('hex'), createHash(algorithm.replace('-', '').toLowerCase()).update(input).digest('hex'));
  }
});

test('invalid algorithms, input and result shapes fail explicitly', async () => {
  let calls = 0;
  const never = { digest() { calls++; throw new Error('unexpected provider call'); } };
  await assert.rejects(performDigest('SHA-1', new Uint8Array(), never), /unsupported/);
  await assert.rejects(performDigest('constructor', new Uint8Array(), never), /unsupported/);
  await assert.rejects(performDigest('SHA-256', 'text', never), /bytes/);
  await assert.rejects(performDigest('SHA-256', new Uint8Array(1048577), never), /1 MiB/);
  assert.equal(calls, 0);
  for (const result of [new ArrayBuffer(31), new ArrayBuffer(33), new Uint8Array(32), '32'])
    await assert.rejects(performDigest('SHA-256', new Uint8Array(), { async digest() { return result; } }), /invalid digest result/);
  await assert.rejects(performDigest('SHA-256', new Uint8Array(), { async digest() { throw new Error('provider failure'); } }), /provider failure/);
});
