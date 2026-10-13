import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performRateLimit } from '../lib/rate-limit.mjs';

test('rate-limit replies preserve booleans without truthiness coercion', async () => {
  for (const success of [true, false]) {
    const result = await performRateLimit({ async limit({ key }) { assert.equal(key, ''); return { success }; } }, '');
    assert.deepEqual(result.bytes, Uint8Array.of(success ? 1 : 0));
  }
  for (const result of [null, {}, { success: 'false' }, { success: 1 }])
    await assert.rejects(performRateLimit({ async limit() { return result; } }, 'key'), /invalid/);
});

test('rate-limit key bounds count UTF-8 bytes before calling the binding', async () => {
  await assert.rejects(performRateLimit({ limit() { assert.fail('oversized key reached host'); } }, '☁'.repeat(22000)), /exceeds/);
  await assert.rejects(performRateLimit({ async limit() { throw new Error('host error'); } }, 'key'), /host error/);
});
