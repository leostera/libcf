const encoder = new TextEncoder();
export async function performRateLimit(binding, key) {
  if (encoder.encode(key).length > 65536) throw new RangeError('rate limit key exceeds 64 KiB');
  const result = await binding.limit({ key });
  if (!result || typeof result.success !== 'boolean') throw new TypeError('invalid rate limit outcome');
  return { status: 0, bytes: Uint8Array.of(result.success ? 1 : 0) };
}
