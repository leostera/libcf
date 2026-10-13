const decoder = new TextDecoder("utf-8", { fatal: true });
export function decodeAnalytics(body) {
  if (body.length > 16820) throw new RangeError("analytics wire exceeds limits");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let offset = 0;
  function take(size) {
    if (size > body.length - offset) throw new TypeError("truncated analytics wire");
    const bytes = body.subarray(offset, offset + size);
    offset += size;
    return bytes;
  }
  function u32() {
    const start = offset;
    take(4);
    return view.getUint32(start, true);
  }
  function count(max) {
    const value = u32();
    if (value > max) throw new RangeError("analytics count exceeds limit");
    return value;
  }
  function blob(max) {
    const tag = u32();
    const size = u32();
    if (tag > 2 || (tag === 0 && size !== 0) || size > max)
      throw new TypeError("invalid analytics blob");
    const bytes = take(size);
    return {
      size,
      value: tag === 0 ? null : tag === 1 ? decoder.decode(bytes) : bytes.slice().buffer,
    };
  }
  const doubles = [];
  const numberCount = count(20);
  for (let i = 0; i < numberCount; i++) {
    const start = offset;
    take(8);
    const value = view.getFloat64(start, true);
    if (!Number.isFinite(value)) throw new TypeError("analytics doubles must be finite");
    doubles.push(value);
  }
  const blobs = [];
  const blobCount = count(20);
  let budget = 16384;
  for (let i = 0; i < blobCount; i++) {
    const field = blob(budget);
    budget -= field.size;
    blobs.push(field.value);
  }
  const indexes = count(1) ? [blob(96).value] : [];
  if (offset !== body.length) throw new TypeError("trailing analytics wire");
  return { doubles, blobs, indexes };
}
export function performAnalytics(binding, body) {
  binding.writeDataPoint(decodeAnalytics(body));
  // Native writeDataPoint is fire-and-forget. This acknowledges synchronous
  // acceptance, never persistence, query visibility or a delivery receipt.
  return { status: 0, bytes: new Uint8Array() };
}
