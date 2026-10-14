const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const replyLimit = 2940;

function parseRequest(key, body, options) {
  if (key !== '' || !(body instanceof Uint8Array) || body.byteLength !== 0 ||
      typeof options !== 'string' || /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Container inspection request');
  const timeout = Number(options);
  if (timeout > 60000) throw new RangeError('invalid Container inspection limit');
  return timeout;
}

function text(value, minimum, maximum, label = false) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum ||
      (label && /[\u0000-\u001f\u007f-\u009f]/.test(value)))
    throw new TypeError('invalid Container inspection text');
  const bytes = encoder.encode(value);
  if (bytes.length < minimum || bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new TypeError('invalid Container inspection UTF-8 text');
  return bytes;
}

function encodeInspection(value) {
  if (value === null) return { status: 0, bytes: new Uint8Array(4) };
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid Container inspection');
  const image = text(value.image, 0, 2048), labels = value.labels;
  if (labels === null || typeof labels !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(labels)))
    throw new TypeError('invalid Container labels');
  const keys = Object.keys(labels);
  if (keys.length > 10) throw new RangeError('invalid Container label count');
  const entries = keys.map(key => ({ name: text(key, 1, 16, true), value: text(labels[key], 0, 64, true) }));
  const size = 12 + image.length + entries.reduce((sum, entry) => sum + 8 + entry.name.length + entry.value.length, 0);
  if (size > replyLimit) throw new RangeError('Container inspection reply exceeds limit');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let offset = 0;
  const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
  const string = value => { u32(value.length); bytes.set(value, offset); offset += value.length; };
  u32(1); string(image); u32(entries.length);
  for (const entry of entries) { string(entry.name); string(entry.value); }
  return { status: 0, bytes };
}

// Borrows the DO capability; never starts, stops or disposes the container itself.
// Invocation activity can still extend a running container's inactivity window.
export async function performContainerInspect(binding, key, body, options, signal) {
  const timeout = parseRequest(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Container inspection signal');
  signal?.throwIfAborted();
  const invoke = binding?.inspect;
  if (typeof invoke !== 'function') throw new TypeError('Container inspection unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Container inspection disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // At most two roots: pending read and projected result. Releasing a lease
    // neither stops a process nor establishes cancellation of native work.
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
  const timer = setTimeout(() => controller.abort(new DOMException('Container inspection deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, binding, []));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodeInspection(value);
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
