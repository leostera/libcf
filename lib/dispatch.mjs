import { performService } from './service.mjs';
const encoder = new TextEncoder();

function parseTarget(options) {
  if (typeof options !== 'string' ||
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}:[1-9][0-9]{0,4}:(0|[1-9][0-9]{0,3})$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid dispatch target');
  const [name, cpu, subrequests] = options.split(':');
  const limits = { cpuMs: Number(cpu), subRequests: Number(subrequests) };
  if (limits.cpuMs > 30000 || limits.subRequests > 1000)
    throw new RangeError('invalid dispatch limits');
  return { name, limits };
}

function discard(response) {
  if (!(response instanceof Response)) return;
  try { response.webSocket?.close(1000, 'dispatch upgrades unsupported'); } catch {}
  try {
    if (response.body && !response.body.locked) void response.body.cancel('dispatch rejected response').catch(() => {});
  } catch {}
}

export async function performDispatch(binding, url, body, options, helpers, signal) {
  const { name, limits } = parseTarget(options);
  if (typeof url !== 'string' || url.length > 65536 || encoder.encode(url).length > 65536)
    throw new TypeError('invalid dispatch URL');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new TypeError('dispatch requires an http(s) URL without credentials');
  if (!(body instanceof Uint8Array) || body.byteLength > 1048576)
    throw new TypeError('invalid dispatch wire size');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid dispatch signal');
  signal?.throwIfAborted();
  return performService({ async fetch(request) {
    if (request.headers.has('upgrade')) throw new TypeError('dispatch upgrades unsupported');
    signal?.throwIfAborted();
    // Resolve only after HTTP validation. Per-call Fetchers avoid retaining props
    // or capabilities across requests. Limits are provider policy, not a timer.
    const get = binding?.get;
    if (typeof get !== 'function') throw new TypeError('dispatch namespace unavailable');
    const target = Reflect.apply(get, binding, [name, {}, { limits }]);
    signal?.throwIfAborted();
    const invoke = target?.fetch;
    if (typeof invoke !== 'function') throw new TypeError('dispatch Fetcher unavailable');
    const outgoing = new Request(request, { redirect: 'manual', signal });
    signal?.throwIfAborted();
    let response;
    try {
      response = await Reflect.apply(invoke, target, [outgoing]);
      signal?.throwIfAborted();
      if (!(response instanceof Response) || response.status < 200 || response.status > 599 || response.webSocket)
        throw new TypeError('unsupported dispatch response');
      return response;
    } catch (error) {
      discard(response);
      throw error;
    }
  } }, url, body, {
    ...helpers,
    readBounded: stream => helpers.readBounded(stream, 1048576, signal),
  });
}
