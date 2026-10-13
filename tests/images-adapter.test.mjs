import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performImageInfo } from '../lib/images.mjs';
const raster = { format: 'image/png', fileSize: 70, width: 2, height: 3 };
test('image bytes are copied before await and raster metadata has a bounded golden wire', async () => {
  const input = new Uint8Array([9, 1, 0, 255, 9]);
  const result = await performImageInfo({ async info(stream) {
    input.fill(8);
    assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([1, 0, 255]));
    return raster;
  } }, input.subarray(1, 4));
  assert.equal(Buffer.from(result.bytes).toString('hex'), '0100000046000000020000000300000009000000696d6167652f706e67');
  assert.deepEqual((await performImageInfo({ async info() { return { format: 'image/svg+xml' }; } }, new Uint8Array([1]))).bytes, new Uint8Array(4));
});
test('invalid input never calls the provider; malformed metadata fails closed', async () => {
  let calls = 0;
  for (const input of [new Uint8Array(), new Uint8Array(1048577), null])
    await assert.rejects(performImageInfo({ info() { calls++; } }, input));
  assert.equal(calls, 0);
  for (const result of [null, {}, { ...raster, format: 'image/png\n' }, { ...raster, format: 'text/plain' },
    { ...raster, width: 0 }, { ...raster, height: 1.5 }, { ...raster, width: 2 ** 32 },
    { ...raster, fileSize: 1048577 }, { ...raster, fileSize: NaN }])
    await assert.rejects(performImageInfo({ async info() { return result; } }, new Uint8Array([1])));
});
test('provider failure cancels an unlocked unconsumed input stream', async () => {
  let input;
  await assert.rejects(performImageInfo({ async info(stream) { input = stream; throw new Error('provider failed'); } }, new Uint8Array([1])), /provider failed/);
  const reader = input.getReader();
  try { assert.equal((await reader.read()).done, true); }
  finally { reader.releaseLock(); }
});
