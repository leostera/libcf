const encoder = new TextEncoder();
export async function performImageInfo(binding, body) {
  if (!(body instanceof Uint8Array) || !body.length || body.length > 1048576)
    throw new RangeError('image must contain 1..1048576 bytes');
  const stream = new Blob([body]).stream();
  let info;
  try { info = await binding.info(stream); }
  finally { if (!stream.locked) void stream.cancel().catch(() => {}); }
  if (info?.format === 'image/svg+xml') return { status: 0, bytes: new Uint8Array(4) };
  const format = info?.format;
  if (typeof format !== 'string' || format.length <= 6 || format.length > 128 || !format.startsWith('image/') ||
      /[^a-z0-9.+-]/.test(format.slice(6))) throw new TypeError('invalid image media type');
  for (const value of [info.fileSize, info.width, info.height])
    if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) throw new TypeError('invalid image dimensions or size');
  if (info.fileSize > 1048576) throw new RangeError('image info exceeds input cap');
  const media = encoder.encode(format);
  const bytes = new Uint8Array(20 + media.length);
  const wire = new DataView(bytes.buffer);
  for (const [index, value] of [1, info.fileSize, info.width, info.height, media.length].entries())
    wire.setUint32(index * 4, value, true);
  bytes.set(media, 20);
  return { status: 0, bytes };
}
