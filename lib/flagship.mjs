const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function text(value, minimum, maximum, identifier = false) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum ||
      (identifier && /[\u0000-\u001f\u007f-\u009f]/.test(value)))
    throw new TypeError('invalid Flagship text');
  const bytes = encoder.encode(value);
  if (bytes.length < minimum || bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new TypeError('invalid Flagship UTF-8 text');
  return bytes;
}

function parseRequest(key, body, options) {
  text(key, 1, 128, true);
  if (!(body instanceof Uint8Array) || body.byteLength > 256 || typeof options !== 'string')
    throw new TypeError('invalid Flagship request');
  const match = /^(0|1):([1-9][0-9]{0,4})$/.exec(options);
  if (!match || match[0] !== options) throw new TypeError('invalid Flagship request');
  const timeout = Number(match[2]);
  if (timeout > 60000) throw new RangeError('invalid Flagship limit');
  // Decode before yielding: no reference to caller-owned bytes escapes parsing.
  let context;
  if (body.byteLength) {
    const targetingKey = decoder.decode(body);
    text(targetingKey, 1, 256, true);
    context = { targetingKey };
  }
  return { key, fallback: match[1] === '1', timeout, context };
}

function encodeDetails(value, key) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid Flagship details');
  const flagKey = value.flagKey, selected = value.value;
  if (flagKey !== key || typeof selected !== 'boolean') throw new TypeError('invalid Flagship details');
  const fields = [['variant', 256], ['reason', 64], ['errorCode', 64], ['errorMessage', 4096]].map(([name, cap]) => {
    const field = value[name];
    return field === undefined ? undefined : text(field, 0, cap);
  });
  const size = 4 + fields.reduce((sum, field) => sum + 4 + (field === undefined ? 0 : 4 + field.length), 0);
  // Four optional bounded strings and one boolean: at most 4516 bytes.
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let offset = 0;
  const u32 = number => { view.setUint32(offset, number, true); offset += 4; };
  u32(selected ? 1 : 0);
  for (const field of fields) {
    u32(field === undefined ? 0 : 1);
    if (field !== undefined) { u32(field.length); bytes.set(field, offset); offset += field.length; }
  }
  return { status: 0, bytes };
}

// Evaluation only. Provider fallback details are preserved, never fabricated
// from transport failures. This deliberately supports only targetingKey context.
export async function performFlagshipBooleanDetails(binding, key, body, options, signal) {
  const request = parseRequest(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Flagship signal');
  signal?.throwIfAborted();
  const invoke = binding?.getBooleanDetails;
  if (typeof invoke !== 'function') throw new TypeError('Flagship evaluation unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Flagship disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // Two roots at most: pending call and result. Never dispose the borrowed binding.
    if (value !== binding && value !== null && ['object', 'function'].includes(typeof value)) {
      if (closed || controller.signal.aborted) dispose(value);
      else owned.add(value);
    }
    return value;
  };
  const abort = () => { releaseAll(); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('Flagship evaluation deadline exceeded', 'TimeoutError')), request.timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const args = [request.key, request.fallback];
        if (request.context !== undefined) args.push(request.context);
        const pending = own(Reflect.apply(invoke, binding, args));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodeDetails(value, request.key);
      } finally { releaseAll(); }
    });
    const result = await Promise.race([observed, canceled]);
    controller.signal.throwIfAborted();
    succeeded = true;
    return result;
  } finally {
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', abort);
    releaseAll();
    if (succeeded && cleanupFailed) throw cleanupError;
  }
}
