export async function performSleep(body, signal, timers = globalThis) {
  if (!(body instanceof Uint8Array) || body.byteLength !== 4) throw new TypeError('invalid sleep wire');
  const milliseconds = new DataView(body.buffer, body.byteOffset, 4).getUint32(0, true);
  if (milliseconds > 60000) throw new RangeError('sleep requires 0..60000 milliseconds');
  signal?.throwIfAborted();
  let timer;
  let abort;
  try {
    await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      timer = timers.setTimeout(resolve, milliseconds);
      if (signal?.aborted) abort();
    });
    return { status: 0, bytes: new Uint8Array() };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (timer !== undefined) timers.clearTimeout(timer);
  }
}
