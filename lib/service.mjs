const decoder = new TextDecoder('utf-8', { fatal: true });

function requestFromWire(url, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1048576)
    throw new RangeError('service request wire exceeds limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  function u32() {
    if (bytes.length - offset < 4) throw new TypeError('truncated service request');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function take(length) {
    if (length > bytes.length - offset) throw new TypeError('invalid service field length');
    const value = bytes.slice(offset, offset + length);
    offset += length;
    return value;
  }
  const method = decoder.decode(take(u32()));
  if (!method.length || method.length > 32) throw new RangeError('invalid service method size');
  const headerSize = u32();
  if (headerSize > 65536 || headerSize > bytes.length - offset) throw new RangeError('invalid service headers');
  const headerEnd = offset + headerSize;
  const headers = new Headers();
  while (offset < headerEnd) {
    const nameSize = u32();
    const valueSize = u32();
    if (nameSize + valueSize > headerEnd - offset) throw new TypeError('invalid service header length');
    headers.append(decoder.decode(take(nameSize)), decoder.decode(take(valueSize)));
  }
  const bodySize = u32();
  if (bodySize > 1048576) throw new RangeError('service request body exceeds limit');
  const body = take(bodySize);
  if (offset !== bytes.length) throw new TypeError('trailing service request data');
  return new Request(url, { method, headers, ...(body.length ? { body } : {}) });
}

export async function performService(binding, url, body, { encodeFields, encodeHeaders, readBounded }) {
  const request = requestFromWire(url, body);
  const response = await binding.fetch(request);
  const bytes = await readBounded(response.body);
  return { status: 0, bytes: encodeFields([String(response.status), encodeHeaders(response.headers), bytes]) };
}
