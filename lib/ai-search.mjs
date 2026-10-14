const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const recordLimit = 18708; // Three lengths, 256-byte ID, binary64, 2048-byte key, 16384-byte text.

function parseQuery(key, body, options) {
  if (key !== '' || !(body instanceof Uint8Array) || !body.byteLength || body.byteLength > 4096 ||
      typeof options !== 'string' || /^[1-9][0-9]?:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid AI Search query');
  const [count, timeout] = options.split(':').map(Number);
  if (count > 50 || timeout > 60000) throw new RangeError('invalid AI Search limits');
  // Decode before suspension; never retain a view into Wasm memory.
  return { query: decoder.decode(body), count, timeout };
}

function textBytes(value, limit, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > limit)
    throw new TypeError('invalid AI Search text field');
  const bytes = encoder.encode(value);
  if (bytes.byteLength > limit || decoder.decode(bytes) !== value)
    throw new TypeError('invalid AI Search UTF-8 field');
  return bytes;
}

function encodeChunks(value, count) {
  const chunks = value?.chunks;
  if (!Array.isArray(chunks)) throw new TypeError('invalid AI Search chunks');
  const length = chunks.length;
  if (!Number.isInteger(length) || length < 0 || length > count) throw new TypeError('invalid AI Search count');
  const records = [];
  for (let i = 0; i < length; ++i) {
    const chunk = chunks[i], score = chunk?.score;
    if (chunk?.type !== 'text' || typeof score !== 'number' || !Number.isFinite(score) ||
        score < 0 || score > 1) throw new TypeError('invalid AI Search text chunk');
    records.push({ id: textBytes(chunk.id, 256), score,
      key: textBytes(chunk.item?.key, 2048), text: textBytes(chunk.text, 16384, true) });
  }
  const size = 4 + records.reduce((total, record) => total + 20 + record.id.length + record.key.length + record.text.length, 0);
  if (size > 4 + count * recordLimit) throw new RangeError('AI Search reply exceeds limit');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, records.length, true);
  let offset = 4;
  const string = value => { view.setUint32(offset, value.length, true); bytes.set(value, offset + 4); offset += 4 + value.length; };
  for (const record of records) {
    string(record.id);
    view.setFloat64(offset, record.score, true); offset += 8;
    string(record.key); string(record.text);
  }
  return { status: 0, bytes };
}

export async function performAiSearch(binding, key, body, options, signal) {
  const { query, count, timeout } = parseQuery(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid AI Search signal');
  signal?.throwIfAborted();
  const invoke = binding?.search;
  if (typeof invoke !== 'function') throw new TypeError('AI Search binding unavailable');
  const controller = new AbortController();
  let pending, accepting = true, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const disposed = new WeakSet();
  const dispose = value => {
    // Only owned return values/promises, never the borrowed environment binding.
    if (value === binding || value === null || !['object', 'function'].includes(typeof value) || disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid AI Search disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const abort = () => { dispose(pending); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('AI Search deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      pending = Reflect.apply(invoke, binding, [{ query, ai_search_options: {
        retrieval: { retrieval_type: 'keyword', keyword_match_mode: 'and', match_threshold: 0,
          max_num_results: count, context_expansion: 0, metadata_only: false, return_on_failure: false },
        query_rewrite: { enabled: false }, reranking: { enabled: false }, cache: { enabled: false },
      } }]);
      if (controller.signal.aborted) dispose(pending);
      return pending;
    }).then(value => {
      try {
        if (!accepting) throw new Error('AI Search request ended');
        controller.signal.throwIfAborted();
        // Ignore metadata, dates and scoring details; no generic JSON traversal.
        return encodeChunks(value, count);
      } finally { dispose(value); }
    });
    const result = await Promise.race([observed, canceled]);
    controller.signal.throwIfAborted();
    succeeded = true;
    return result;
  } finally {
    accepting = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', abort);
    dispose(pending);
    // Preserve primary failures. Late cleanup cannot change an already-settled call.
    if (succeeded && cleanupFailed) throw cleanupError;
  }
}
