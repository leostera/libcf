export async function readBounded(body, limit = 1024 * 1024, signal) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('invalid body byte limit');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid body signal');
  if (!body) {
    signal?.throwIfAborted();
    return new Uint8Array();
  }
  const reader = body.getReader();
  let bytes = new Uint8Array();
  let length = 0;
  let canceled = false;
  const cancel = reason => {
    if (canceled) return;
    canceled = true;
    try { void Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch {}
  };
  const abort = () => cancel('request aborted');
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('body chunk must be Uint8Array');
      const size = value.byteLength;
      if (size > limit - length) {
        // Cancellation is best effort: a producer must not delay or replace
        // the size-limit failure by hanging or rejecting its cleanup promise.
        cancel('body size limit');
        throw new RangeError("body exceeds limit");
      }
      if (size === 0) continue;
      const required = length + size;
      if (required > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(limit, Math.max(required, bytes.byteLength * 2)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      // A default stream may reuse its buffer after a read. Copy each observed
      // chunk before asking for another; retain neither chunks nor empty entries.
      bytes.set(value, length);
      length = required;
    }
    return length === bytes.byteLength ? bytes : bytes.slice(0, length);
  } catch (error) {
    cancel('body read failed');
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
