const decoder = new TextDecoder('utf-8', { fatal: true });

function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  function u32() {
    if (bytes.length - offset < 4) throw new TypeError('truncated cache field');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function take(length) {
    if (length > bytes.length - offset) throw new TypeError('invalid cache length');
    const value = bytes.slice(offset, offset + length);
    offset += length;
    return value;
  }
  return { u32, take, field: () => take(u32()), done: () => offset === bytes.length };
}

function decodeResponse(bytes) {
  const input = reader(bytes);
  const statusText = decoder.decode(input.field());
  if (!/^\d{3}$/.test(statusText)) throw new TypeError('invalid cache response status');
  const status = Number(statusText);
  if (status < 200 || status > 599) throw new TypeError('invalid cache response status');
  const headerBytes = input.field();
  if (headerBytes.length > 65536) throw new RangeError('cache headers exceed bridge limit');
  const fields = reader(headerBytes);
  const headers = new Headers();
  while (!fields.done()) {
    const nameLength = fields.u32();
    const valueLength = fields.u32();
    headers.append(decoder.decode(fields.take(nameLength)), decoder.decode(fields.take(valueLength)));
  }
  const body = input.field();
  if (!input.done()) throw new TypeError('trailing cache bytes');
  if ([204, 205, 304].includes(status)) {
    if (body.length) throw new TypeError('null-body status has body bytes');
    return new Response(null, { status, headers });
  }
  return new Response(body, { status, headers });
}

export async function performCache(method, name, url, body, { encodeFields, encodeHeaders, readBounded }) {
  const cache = name ? await caches.open(name) : caches.default;
  const request = new Request(url);
  switch (method) {
    case 48: {
      const response = await cache.match(request);
      if (!response) return { status: 1, bytes: new Uint8Array() };
      const bytes = await readBounded(response.body);
      return { status: 0, bytes: encodeFields([String(response.status), encodeHeaders(response.headers), bytes]) };
    }
    case 49:
      await cache.put(request, decodeResponse(body));
      return { status: 0, bytes: new Uint8Array() };
    case 50:
      return { status: 0, bytes: Uint8Array.of(await cache.delete(request) ? 1 : 0) };
    default: throw new TypeError('unknown cache operation');
  }
}
