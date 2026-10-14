const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function parseQuery(key, body, options) {
  if (key !== '' || !(body instanceof Uint8Array) || body.byteLength < 4 ||
      body.byteLength > 1536 * 4 || body.byteLength % 4 !== 0 ||
      typeof options !== 'string' || /^[1-9][0-9]{0,2}:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Vectorize query');
  const [topK, timeout] = options.split(':').map(Number);
  if (topK > 100 || timeout > 60000) throw new RangeError('invalid Vectorize query limits');
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // Copy before the provider can suspend; do not retain a Wasm-backed view.
  const vector = Array.from({ length: body.byteLength / 4 }, (_, i) => view.getFloat32(i * 4, true));
  if (!vector.every(Number.isFinite)) throw new TypeError('non-finite Vectorize dimension');
  return { vector, topK, timeout };
}

function encodeMatches(result, topK) {
  const matches = result?.matches;
  if (!Array.isArray(matches) || matches.length > topK || result.count !== matches.length)
    throw new TypeError('invalid Vectorize matches');
  const records = matches.map(match => {
    const text = match?.id, score = match?.score;
    if (typeof text !== 'string' || text.length < 1 || text.length > 64 ||
        typeof score !== 'number' || !Number.isFinite(score))
      throw new TypeError('invalid Vectorize match');
    const id = encoder.encode(text);
    if (id.byteLength > 64 || decoder.decode(id) !== text)
      throw new TypeError('invalid Vectorize ID encoding');
    return { id, score };
  });
  const bytes = new Uint8Array(4 + records.reduce((size, record) => size + 12 + record.id.byteLength, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, records.length, true);
  let offset = 4;
  for (const { id, score } of records) {
    view.setUint32(offset, id.byteLength, true);
    bytes.set(id, offset + 4);
    view.setFloat64(offset + 4 + id.byteLength, score, true);
    offset += 12 + id.byteLength;
  }
  return { status: 0, bytes };
}

export async function performVectorize(binding, key, body, options, signal) {
  const { vector, topK, timeout } = parseQuery(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Vectorize signal');
  signal?.throwIfAborted();
  const invoke = binding?.query;
  if (typeof invoke !== 'function') throw new TypeError('Vectorize binding unavailable');
  let timer, onAbort;
  try {
    const canceled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new DOMException('Vectorize deadline exceeded', 'TimeoutError')), timeout);
    });
    const pending = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return Reflect.apply(invoke, binding, [vector, { topK, returnValues: false, returnMetadata: 'none' }]);
    });
    // Native query has no signal/raw-response option. Observe late rejection but
    // discard late results: this bounds our wait, not provider parsing or billing.
    const result = await Promise.race([pending, canceled]);
    signal?.throwIfAborted();
    return encodeMatches(result, topK);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
