export async function readBounded(body, limit = 1024 * 1024, signal) {
  if (!body) {
    signal?.throwIfAborted();
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  const abort = () => { void reader.cancel('request aborted').catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel('body size limit');
        throw new RangeError('body exceeds limit');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
