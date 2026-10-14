const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function text(value, maximum) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum)
    throw new TypeError('invalid Artifacts metadata text');
  const bytes = encoder.encode(value);
  if (bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new TypeError('invalid Artifacts metadata UTF-8 text');
  return bytes;
}
function parseRequest(key, body, options) {
  if (typeof key !== 'string' || key.length > 128 || /^[A-Za-z0-9][A-Za-z0-9._-]*$/.exec(key)?.[0] !== key ||
      !(body instanceof Uint8Array) || body.byteLength !== 0 || typeof options !== 'string' ||
      /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Artifacts metadata request');
  const timeout = Number(options);
  if (timeout > 60000) throw new RangeError('invalid Artifacts metadata limit');
  return timeout;
}
function encodeInfo(value, key) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid Artifacts metadata');
  const id = text(value.id, 128), name = value.name;
  if (name !== key) throw new TypeError('invalid Artifacts metadata name');
  const fields = [id, text(name, 128), text(value.defaultBranch, 256)];
  const readOnly = value.readOnly;
  if (typeof readOnly !== 'boolean') throw new TypeError('invalid Artifacts metadata readOnly');
  // Deliberately exclude URLs, credentials, descriptions, timestamps and source.
  const bytes = new Uint8Array(16 + fields.reduce((sum, field) => sum + field.length, 0));
  const view = new DataView(bytes.buffer); let offset = 0;
  const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
  u32(readOnly ? 1 : 0);
  for (const field of fields) { u32(field.length); bytes.set(field, offset); offset += field.length; }
  return { status: 0, bytes };
}

// Existing named repository only. No enumeration, creation, import, tokens or
// implicit compensation. Releasing a repository capability does not delete it.
export async function performArtifactsInfo(binding, key, body, options, signal) {
  const timeout = parseRequest(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Artifacts metadata signal');
  signal?.throwIfAborted();
  const acquire = binding?.get;
  if (typeof acquire !== 'function') throw new TypeError('Artifacts repository lookup unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Artifacts metadata disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // At most four owned roots: acquisition, repository, read, result.
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
  const timer = setTimeout(() => controller.abort(new DOMException('Artifacts metadata deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const acquisition = own(Reflect.apply(acquire, binding, [key]));
        const repository = own(await acquisition);
        controller.signal.throwIfAborted();
        const invoke = repository?.info;
        if (typeof invoke !== 'function') throw new TypeError('Artifacts repository info unavailable');
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, repository, []));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodeInfo(value, key);
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
