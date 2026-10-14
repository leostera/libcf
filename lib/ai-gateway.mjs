const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const prefix = 'https://gateway.ai.cloudflare.com/v1/';
const maxUrlBytes = prefix.length + 128 + 1 + 64 + 1 + 64;
function selector(value) {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9][a-z0-9-]*$/.exec(value)?.[0] === value;
}
function parseRequest(key, body, options) {
  if (!selector(key) || !(body instanceof Uint8Array) || body.byteLength > 64 || typeof options !== 'string' ||
      /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid AI Gateway URL request');
  const timeout = Number(options);
  if (timeout > 60000) throw new RangeError('invalid AI Gateway URL timeout');
  // Own the optional provider before yielding; empty bytes mean omitted argument.
  const provider = body.length ? decoder.decode(body) : undefined;
  if (provider !== undefined && !selector(provider)) throw new TypeError('invalid AI Gateway URL provider');
  return { provider, timeout };
}
function encodeUrl(value, key, provider) {
  // Deliberately narrow to the documented canonical Cloudflare endpoint shape.
  // No URL normalization, credentials, query, fragment, port or alternate origin.
  if (typeof value !== 'string' || value.length > maxUrlBytes || !value.startsWith(prefix)) throw new TypeError('invalid AI Gateway URL');
  const account = value.slice(prefix.length).split('/')[0];
  if (account.length > 128 || /^[A-Za-z0-9][A-Za-z0-9-]*$/.exec(account)?.[0] !== account ||
      value !== prefix + account + '/' + key + '/' + (provider === undefined || provider === 'universal' ? '' : provider))
    throw new TypeError('invalid AI Gateway URL');
  // The account segment is syntax-checked, not authorization or an owned ID proof.
  return { status: 0, bytes: encoder.encode(value) };
}

// This is backend URL lookup, NOT local construction, existence proof or permission
// to fetch the result. Never infer, enumerate, read/patch logs or retry here.
export async function performAiGatewayUrl(binding, key, body, options, signal) {
  const { provider, timeout } = parseRequest(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid AI Gateway URL signal');
  signal?.throwIfAborted();
  const acquire = binding?.gateway;
  if (typeof acquire !== 'function') throw new TypeError('AI Gateway lookup unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid AI Gateway URL disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // Acquisition, gateway, pending URL and (possibly malformed) result roots.
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
  const timer = setTimeout(() => controller.abort(new DOMException('AI Gateway URL deadline exceeded', 'TimeoutError')), timeout);
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
        const gateway = own(await acquisition);
        controller.signal.throwIfAborted();
        const invoke = gateway?.getUrl;
        if (typeof invoke !== 'function') throw new TypeError('AI Gateway getUrl unavailable');
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, gateway, provider === undefined ? [] : [provider]));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodeUrl(value, key, provider);
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
