// Wire fields are strings, not BOM-prefixed files. Preserve every code point
// so native Request/Headers validation cannot see a silently normalized token.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const isToken = value => value.length > 0 && !/[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(value);

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
  if (!isToken(method)) throw new TypeError('invalid service method token');
  const headerSize = u32();
  if (headerSize > 65536 || headerSize > bytes.length - offset) throw new RangeError('invalid service headers');
  const headerEnd = offset + headerSize;
  const headers = new Headers();
  while (offset < headerEnd) {
    const nameSize = u32();
    const valueSize = u32();
    if (nameSize + valueSize > headerEnd - offset) throw new TypeError('invalid service header length');
    const name = decoder.decode(take(nameSize));
    const value = decoder.decode(take(valueSize));
    // workerd accepts some names that Node Headers rejects. Enforce HTTP field
    // syntax here rather than making safety depend on the host constructor.
    if (!isToken(name) || /[\x00-\x08\x0A-\x1F\x7F]/.test(value)) throw new TypeError('invalid service header');
    headers.append(name, value);
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
