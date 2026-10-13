const encoder = new TextEncoder();
// Matches cf::detail::parse_headers; lengths count UTF-8 bytes, not JS characters.
export function encodeHeaders(headers) {
  const fields = [...headers].map(([name, value]) => [encoder.encode(name), encoder.encode(value)]);
  const length = fields.reduce((total, [name, value]) => total + 8 + name.length + value.length, 0);
  if (length > 65536) throw new RangeError('request headers exceed 64 KiB');
  const buffer = new Uint8Array(length);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  for (const [name, value] of fields) {
    view.setUint32(offset, name.length, true);
    view.setUint32(offset + 4, value.length, true);
    offset += 8;
    buffer.set(name, offset);
    offset += name.length;
    buffer.set(value, offset);
    offset += value.length;
  }
  return buffer;
}
