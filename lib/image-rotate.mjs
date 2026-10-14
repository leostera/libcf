import { readBounded } from './body.mjs';

const maxBytes = 1048576;
const cancelStream = ReadableStream.prototype.cancel;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

// Framing and declared-dimension checks, NOT CRC, decompression or pixel validation.
// Metadata and decoder work remain the provider's responsibility.
export function inspectRotationPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > maxBytes ||
      !signature.every((byte, i) => bytes[i] === byte)) throw new TypeError('invalid rotation PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, chunks = 0, width, height, data = false, seenData = false, endedData = false, palette = false;
  while (offset < bytes.length) {
    if (++chunks > 1024 || offset + 12 > bytes.length) throw new TypeError('invalid PNG framing');
    const size = view.getUint32(offset), end = offset + size + 12;
    if (end > bytes.length) throw new TypeError('invalid PNG chunk length');
    const letters = bytes.subarray(offset + 4, offset + 8);
    if (![...letters].every(c => c >= 65 && c <= 90 || c >= 97 && c <= 122) || (letters[2] & 32))
      throw new TypeError('invalid PNG chunk type');
    const type = String.fromCharCode(...letters);
    if (offset === 8) {
      if (type !== 'IHDR' || size !== 13) throw new TypeError('missing PNG header');
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      if (!width || width > 1024 || !height || height > 1024 || bytes[offset + 16] !== 8 ||
          ![2, 6].includes(bytes[offset + 17]) || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20] > 1)
        throw new TypeError('unsupported rotation PNG header');
    } else if (type === 'IHDR' || ['acTL', 'fcTL', 'fdAT'].includes(type)) {
      throw new TypeError('duplicate header or animated PNG');
    } else if (type === 'IDAT') {
      if (endedData) throw new TypeError('nonconsecutive PNG data');
      seenData = true;
      if (size) data = true;
    } else {
      if (seenData) endedData = true;
      if (type === 'IEND') {
        if (size || !data || end !== bytes.length) throw new TypeError('invalid PNG end');
        return { width, height };
      }
      if (type === 'PLTE') {
        if (seenData || palette || !size || size > 768 || size % 3) throw new TypeError('invalid PNG palette');
        palette = true;
      } else if (!(letters[0] & 32)) throw new TypeError('unsupported PNG critical chunk');
    }
    offset = end;
  }
  throw new TypeError('missing PNG end');
}

export async function performImageRotate(binding, body, options, signal) {
  if (!(body instanceof Uint8Array) || body.length > maxBytes || typeof options !== 'string' ||
      /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options || Number(options) > 60000)
    throw new TypeError('invalid image rotation input');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid image rotation signal');
  signal?.throwIfAborted();
  const snapshot = new Uint8Array(body.length); snapshot.set(body);
  const dimensions = inspectRotationPng(snapshot);
  const input = binding?.input;
  if (typeof input !== 'function') throw new TypeError('Images input binding unavailable');

  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet(), results = new WeakSet(), streams = new WeakMap(), promises = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const root = value => value !== binding && value !== null && ['object', 'function'].includes(typeof value);
  const recordCleanup = error => { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } };
  const imageStream = result => {
    if (!streams.has(result)) {
      // Cache before method access: getters/methods may synchronously abort.
      streams.set(result, undefined);
      const image = result.image;
      if (typeof image !== 'function') throw new TypeError('invalid image result accessor');
      streams.set(result, Reflect.apply(image, result, []));
    }
    return streams.get(result);
  };
  const observePromise = value => {
    if (value instanceof Promise && !promises.has(value)) {
      promises.add(value);
      Promise.prototype.then.call(value, () => {}, () => {});
    }
  };
  const dispose = value => {
    if (!root(value) || disposed.has(value)) return;
    owned.delete(value); disposed.add(value);
    try { observePromise(value); } catch (error) { recordCleanup(error); }
    if (results.has(value)) {
      // The known result accessor exposes already-produced output, not a new
      // transform. Never recursively inspect arbitrary malformed child objects.
      try { dispose(imageStream(value)); } catch (error) { recordCleanup(error); }
    } else if (value instanceof ReadableStream) {
      try { void Promise.resolve(Reflect.apply(cancelStream, value, ['image rotation scope closed'])).catch(() => {}); } catch {}
    }
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid image disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { recordCleanup(error); }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    if (root(value)) {
      // Unexpected native Promises (e.g. asynchronous contentType) are invalid,
      // but their rejection must still be observed while cleanup releases them.
      if (!disposed.has(value)) owned.add(value);
      try {
        observePromise(value);
      } finally {
        if (closed || controller.signal.aborted) dispose(value);
      }
    }
    return value;
  };
  const invoke = (receiver, name, args) => {
    controller.signal.throwIfAborted();
    const method = receiver?.[name];
    controller.signal.throwIfAborted();
    if (typeof method !== 'function') throw new TypeError('invalid image transformer method');
    return own(Reflect.apply(method, receiver, args));
  };
  const abort = () => { releaseAll(); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('image rotation deadline exceeded', 'TimeoutError')), Number(options));
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const source = own(new Blob([snapshot]).stream());
        const builder = own(Reflect.apply(input, binding, [source]));
        const transformed = invoke(builder, 'transform', [{ rotate: 90 }]);
        const pending = invoke(transformed, 'output', [{ format: 'image/png', anim: false }]);
        const result = await pending;
        if (root(result)) {
          results.add(result);
          // A synchronous provider may return its result while aborting. The
          // root was already released; still drain its newly identified body.
          if (disposed.has(result)) {
            try { dispose(imageStream(result)); } catch (error) { recordCleanup(error); }
          }
        }
        own(result);
        controller.signal.throwIfAborted();
        if (!root(result)) throw new TypeError('invalid image result');
        const stream = own(imageStream(result));
        controller.signal.throwIfAborted();
        if (stream === binding || !(stream instanceof ReadableStream)) throw new TypeError('invalid image output stream');
        const type = invoke(result, 'contentType', []);
        if (type !== 'image/png') throw new TypeError('invalid image output type');
        const bytes = await readBounded(stream, maxBytes, controller.signal);
        controller.signal.throwIfAborted();
        const rotated = inspectRotationPng(bytes);
        if (rotated.width !== dimensions.height || rotated.height !== dimensions.width)
          throw new TypeError('invalid rotated dimensions');
        return { status: 0, bytes };
      } finally { releaseAll(); }
    });
    const result = await Promise.race([observed, canceled]);
    controller.signal.throwIfAborted(); succeeded = true; return result;
  } finally {
    closed = true; clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', abort);
    releaseAll();
    if (succeeded && cleanupFailed) throw cleanupError;
  }
}
