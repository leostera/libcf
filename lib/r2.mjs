function objectFields(object) {
  if (!Number.isSafeInteger(object.size) || object.size < 0) throw new RangeError('unsafe R2 object size');
  return [object.key, String(object.size), object.etag, object.httpEtag, object.httpMetadata?.contentType ?? ''];
}
function integer(text) {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new TypeError('invalid R2 integer');
  return Number(text);
}

export async function performR2(method, bucket, key, body, options, { encodeFields, readBounded }) {
  const present = bytes => ({ status: 0, bytes });
  const missing = { status: 1, bytes: new Uint8Array() };
  switch (method) {
    case 32: {
      let range;
      if (options) {
        const parts = options.split('\n');
        if (parts.length !== 2) throw new TypeError('invalid R2 range');
        range = { offset: integer(parts[0]) };
        if (parts[1]) {
          range.length = integer(parts[1]);
          if (!range.length) throw new RangeError('R2 range length must be positive');
        }
      }
      const object = await bucket.get(key, range ? { range } : undefined);
      if (object === null) return missing;
      const bytes = await readBounded(object.body);
      return present(encodeFields([...objectFields(object), bytes]));
    }
    case 33: {
      const object = await bucket.head(key);
      return object === null ? missing : present(encodeFields(objectFields(object)));
    }
    case 34: {
      const object = await bucket.put(key, body, { httpMetadata: { contentType: options } });
      if (!object) throw new Error('R2 put unexpectedly returned null');
      return present(encodeFields(objectFields(object)));
    }
    case 35:
      await bucket.delete(key);
      return present(new Uint8Array());
    case 36: {
      const limit = integer(new TextDecoder().decode(body));
      if (limit < 1 || limit > 1000) throw new RangeError('invalid R2 list limit');
      const page = await bucket.list({ prefix: key, limit, ...(options ? { cursor: options } : {}), include: ['httpMetadata'] });
      const fields = [page.truncated ? page.cursor : '', ...page.objects.flatMap(objectFields)];
      const payload = encodeFields(fields);
      if (payload.length + 8 > 4 * 1024 * 1024) throw new RangeError('R2 list exceeds bridge limit');
      const bytes = new Uint8Array(payload.length + 8);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, page.objects.length, true);
      view.setUint32(4, page.truncated ? 1 : 0, true);
      bytes.set(payload, 8);
      return present(bytes);
    }
    default: throw new TypeError('invalid R2 operation');
  }
}
