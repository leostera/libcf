const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const videoId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.exec(value)?.[0] === value;

function parseRequest(method, key, body, options) {
  if (!(body instanceof Uint8Array) || body.byteLength || typeof options !== 'string')
    throw new TypeError('invalid Stream metadata request');
  let count, timeout;
  if (method === 416) {
    if (key !== '' || /^[1-9][0-9]?:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
      throw new TypeError('invalid Stream list request');
    [count, timeout] = options.split(':').map(Number);
  } else if (method === 417) {
    if (!videoId(key) || /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
      throw new TypeError('invalid Stream details request');
    count = 1; timeout = Number(options);
  } else throw new TypeError('invalid Stream metadata operation');
  if (count > 50 || timeout > 60000) throw new RangeError('invalid Stream metadata limits');
  return { count, timeout };
}

function project(value) {
  const id = value?.id, state = value?.status?.state, ready = value?.readyToStream;
  const size = value?.size, duration = value?.duration;
  if (!videoId(id) || typeof state !== 'string' || !state.length || state.length > 64 ||
      typeof ready !== 'boolean' || !Number.isSafeInteger(size) || size < 0 ||
      typeof duration !== 'number' || !Number.isFinite(duration) || (duration < 0 && duration !== -1))
    throw new TypeError('invalid Stream metadata result');
  const status = encoder.encode(state);
  if (status.length > 64 || decoder.decode(status) !== state) throw new TypeError('invalid Stream status text');
  return { id: encoder.encode(id), status, ready, size, duration };
}

function encode(value, method, key, count) {
  const values = method === 416 ? value : [value];
  if (!Array.isArray(values)) throw new TypeError('invalid Stream metadata list');
  const length = values.length;
  if (!Number.isInteger(length) || length < 0 || length > count) throw new TypeError('invalid Stream metadata count');
  const records = [];
  for (let i = 0; i < length; ++i) records.push(project(values[i]));
  if (method === 417 && decoder.decode(records[0].id) !== key) throw new TypeError('Stream video ID mismatch');
  const size = 4 + records.reduce((total, record) => total + 28 + record.id.length + record.status.length, 0);
  if (size > 4 + count * 220) throw new RangeError('Stream metadata reply exceeds limit');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, records.length, true);
  let offset = 4;
  const string = text => { view.setUint32(offset, text.length, true); bytes.set(text, offset + 4); offset += 4 + text.length; };
  for (const record of records) {
    string(record.id); string(record.status);
    view.setUint32(offset, record.ready ? 1 : 0, true);
    view.setUint32(offset + 4, record.size % 4294967296, true);
    view.setUint32(offset + 8, Math.floor(record.size / 4294967296), true);
    view.setFloat64(offset + 12, record.duration, true);
    offset += 20;
  }
  return { status: 0, bytes };
}

export async function performStreamVideo(method, binding, key, body, options, signal) {
  const { count, timeout } = parseRequest(method, key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Stream metadata signal');
  signal?.throwIfAborted();
  if (!binding) throw new TypeError('Stream binding unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Stream disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // Up to four owned roots: acquisition promise, scope, read promise, result.
    // Scope disposal releases a lease, never deletes a video or the borrowed binding.
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
  const timer = setTimeout(() => controller.abort(new DOMException('Stream metadata deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        let acquisition;
        if (method === 416) acquisition = own(binding.videos);
        else {
          const acquire = binding.video;
          if (typeof acquire !== 'function') throw new TypeError('Stream video handle unavailable');
          controller.signal.throwIfAborted();
          acquisition = own(Reflect.apply(acquire, binding, [key]));
        }
        const scope = own(await acquisition);
        controller.signal.throwIfAborted();
        const invoke = method === 416 ? scope?.list : scope?.details;
        if (typeof invoke !== 'function') throw new TypeError('Stream metadata method unavailable');
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, scope, method === 416 ? [{ limit: count }] : []));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encode(value, method, key, count);
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
