import { selectBoundHttpsEndpoint } from './outbound-policy.mjs';
import { readBounded } from './body.mjs';
const cancelStream = ReadableStream.prototype.cancel;

// GET-only mechanics, not certificate identity, verify_full or routing proof.
// The caller must supply a trusted policy and the corresponding borrowed binding.
export async function performBoundHttpsGet(binding, policy, kind, bindingName, name, body, options, signal) {
  const endpoint = selectBoundHttpsEndpoint(policy, kind, bindingName, name);
  if (!(body instanceof Uint8Array) || body.length || typeof options !== 'string' ||
      /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options || Number(options) > 60000)
    throw new TypeError('invalid outbound GET options');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid outbound GET signal');
  signal?.throwIfAborted();
  const invoke = binding?.fetch;
  if (typeof invoke !== 'function') throw new TypeError('outbound fetch binding unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet(), responses = new WeakSet(), bodies = new WeakMap();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const root = value => value !== binding && value !== null && ['object', 'function'].includes(typeof value);
  const recordCleanup = error => { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } };
  const responseBody = response => {
    if (!bodies.has(response)) {
      // Mark before reading: an accessor can synchronously abort or throw.
      // Neither cleanup nor reentrancy may read the body property twice.
      bodies.set(response, undefined);
      bodies.set(response, response.body);
    }
    return bodies.get(response);
  };
  const dispose = value => {
    if (!root(value) || disposed.has(value)) return;
    owned.delete(value); disposed.add(value);
    // Include late/rejected responses whose body was never projected. Dispose
    // child streams before their response, including malformed acquired children.
    if (responses.has(value)) {
      try { dispose(responseBody(value)); } catch (error) { recordCleanup(error); }
    } else if (value instanceof ReadableStream) {
      // Locked active streams are canceled by readBounded's reader. Never await
      // producer cleanup; it must not delay or replace the primary failure.
      try { void Promise.resolve(Reflect.apply(cancelStream, value, ['outbound GET scope closed'])).catch(() => {}); } catch {}
    }
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid outbound disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { recordCleanup(error); }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    if (root(value)) {
      if (closed || controller.signal.aborted) dispose(value); else owned.add(value);
    }
    return value;
  };
  const ownResponse = value => {
    // Only provider-returned Response roots may expose a body. A malformed body
    // that is itself a Response must not trigger arbitrary recursive traversal.
    if (value instanceof Response) responses.add(value);
    return own(value);
  };
  const abort = () => { releaseAll(); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('outbound GET deadline exceeded', 'TimeoutError')), Number(options));
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        // A fresh Request carries no inbound headers/body or caller URL. Do not
        // use credentials:omit as a substitute for reviewing transport identity.
        const request = new Request(endpoint.url, { method: 'GET', redirect: 'manual', signal: controller.signal });
        const pending = ownResponse(Reflect.apply(invoke, binding, [request]));
        const response = ownResponse(await pending);
        controller.signal.throwIfAborted();
        if (!(response instanceof Response)) throw new TypeError('invalid outbound response');
        const status = response.status, redirected = response.redirected;
        if (status !== 200 || redirected !== false) throw new TypeError('outbound GET requires an unredirected 200 response');
        const stream = own(responseBody(response));
        controller.signal.throwIfAborted();
        if (stream !== null && !(stream instanceof ReadableStream)) throw new TypeError('invalid outbound response body');
        const bytes = await readBounded(stream, 1048576, controller.signal);
        controller.signal.throwIfAborted();
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
