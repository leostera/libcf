import { readBounded } from './body.mjs';

const limit = 1048576;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function parseFrame(key, body, options) {
  if (key !== '' || !(body instanceof Uint8Array) || !body.byteLength || body.byteLength > limit ||
      typeof options !== 'string' || /^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Media frame request');
  const [width, height, timeout] = options.split(':').map(Number);
  if (width < 10 || width > 512 || height < 10 || height > 512 || timeout > 60000)
    throw new RangeError('invalid Media frame limits');
  return { width, height, timeout };
}

function cancelStream(stream) {
  try { if (stream && !stream.locked) void Promise.resolve(stream.cancel()).catch(() => {}); } catch {}
}

function discardResponse(response) {
  if (!(response instanceof Response)) return;
  try { cancelStream(response.body); } catch {}
  try { response.webSocket?.close(1000, 'Media response discarded'); } catch {}
}

async function readFrame(response, signal) {
  try {
    const contentType = response instanceof Response ? response.headers.get('content-type') : undefined;
    if (!(response instanceof Response) || response.status !== 200 || response.webSocket ||
        typeof contentType !== 'string' || contentType.length > 128 ||
        contentType.split(';', 1)[0].trim().toLowerCase() !== 'image/png' || !response.body)
      throw new TypeError('invalid Media frame response');
  } catch (error) {
    discardResponse(response);
    throw error;
  }
  // From here the reader owns body cancellation, including overflow and abort.
  const bytes = await readBounded(response.body, limit, signal);
  if (bytes.byteLength < pngSignature.length || !pngSignature.every((value, i) => bytes[i] === value))
    throw new TypeError('invalid Media PNG signature');
  // Signature/MIME checks are not a full PNG decode or dimension verification.
  return { status: 0, bytes };
}

export async function performMediaFrame(binding, key, body, options, signal) {
  const { width, height, timeout } = parseFrame(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Media signal');
  signal?.throwIfAborted();
  const invoke = binding?.input;
  if (typeof invoke !== 'function') throw new TypeError('Media binding unavailable');
  // Blob snapshots before suspension: neither the builder nor the provider sees Wasm memory.
  const input = new Blob([body]).stream();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('Media deadline exceeded', 'TimeoutError')), timeout);
  let accepting = true, rejectOnAbort;
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      if (controller.signal.aborted) rejectOnAbort();
    });
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      const transformer = Reflect.apply(invoke, binding, [input]);
      controller.signal.throwIfAborted();
      const generator = transformer.transform({ width, height, fit: 'contain' });
      controller.signal.throwIfAborted();
      const result = generator.output({ mode: 'frame', time: '0s', format: 'png' });
      controller.signal.throwIfAborted();
      // Exactly one use of the native single-use chain; no contentType/media second call.
      return result.response();
    }).then(response => {
      if (!accepting || controller.signal.aborted) {
        discardResponse(response);
        throw controller.signal.reason ?? new Error('Media request ended');
      }
      return readFrame(response, controller.signal);
    });
    // Native builders expose no public AbortSignal option. Late completion is observed
    // and discarded, but this cannot promise stopped processing, billing or rollback.
    const result = await Promise.race([pending, canceled]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    accepting = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    cancelStream(input);
  }
}
