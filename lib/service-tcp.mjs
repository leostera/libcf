import { readBounded } from './body.mjs';

function parseExchange(address, body, options) {
  const target = typeof address === 'string' && /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([1-9][0-9]{0,4})$/.exec(address);
  const budgets = typeof options === 'string' && /^([1-9][0-9]{0,4}):([1-9][0-9]{0,6})$/.exec(options);
  if (!target || target[0] !== address || Number(target[2]) > 65535) throw new TypeError('invalid service TCP address');
  if (!budgets || budgets[0] !== options || Number(budgets[1]) > 60000 || Number(budgets[2]) > 1048576)
    throw new RangeError('invalid service TCP budgets');
  if (!(body instanceof Uint8Array) || body.byteLength > 1048576)
    throw new RangeError('invalid service TCP body');
  return { hostname: target[1], port: Number(target[2]), timeoutMs: Number(budgets[1]),
    responseLimit: Number(budgets[2]), body: new Uint8Array(body) };
}

// One bounded half-close/EOF exchange, not a persistent socket or DB protocol API.
export async function performServiceTcp(binding, address, body, options, signal) {
  const request = parseExchange(address, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid abort signal');
  signal?.throwIfAborted();
  if (typeof binding?.connect !== 'function') throw new TypeError('service TCP binding unavailable');
  const controller = new AbortController();
  let socket;
  let writer;
  let closeAttempted = false;
  const close = () => {
    if (!socket || closeAttempted) return;
    closeAttempted = true;
    // Cancellation/cleanup must never wait for a peer or replace the first error.
    try { Promise.resolve(socket.close()).catch(() => {}); } catch {}
  };
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { close(); rejectAbort(controller.signal.reason); };
  const forwardAbort = () => controller.abort(signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const deadline = setTimeout(() => controller.abort(new DOMException('service TCP deadline exceeded', 'TimeoutError')), request.timeoutMs);
  const exchange = async () => {
    controller.signal.throwIfAborted();
    socket = binding.connect({ hostname: request.hostname, port: request.port },
      { secureTransport: 'off', allowHalfOpen: true });
    if (!socket || typeof socket.close !== 'function' || typeof socket.opened?.then !== 'function' ||
        typeof socket.closed?.then !== 'function') throw new TypeError('invalid service TCP socket');
    void Promise.resolve(socket.closed).catch(error => controller.abort(error));
    await socket.opened;
    controller.signal.throwIfAborted();
    writer = socket.writable.getWriter();
    const send = async () => {
      if (request.body.byteLength) await writer.write(request.body);
      await writer.close();
    };
    // Awaiting all writes before reading deadlocks against a backpressured echo peer.
    const [bytes] = await Promise.all([
      readBounded(socket.readable, request.responseLimit, controller.signal), send(),
    ]);
    controller.signal.throwIfAborted();
    return { status: 0, bytes };
  };
  try {
    return await Promise.race([exchange(), aborted]);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', forwardAbort);
    controller.abort(new DOMException('service TCP exchange finished', 'AbortError'));
    controller.signal.removeEventListener('abort', onAbort);
    close();
    try { writer?.releaseLock(); } catch {}
  }
}
