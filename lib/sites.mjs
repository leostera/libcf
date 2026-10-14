import { parseBoundedJson } from './json.mjs';
import { readBounded } from './body.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const manifests = new WeakMap();
const localPrefix = '$__MINIFLARE_SITES__$/';
const maximum = 1048576;
const cancelStream = ReadableStream.prototype.cancel;

function text(value, minimum, limit) {
  if (typeof value !== 'string' || value.length < minimum || value.length > limit) throw new TypeError('invalid Sites text');
  const bytes = encoder.encode(value);
  if (bytes.length < minimum || bytes.length > limit || decoder.decode(bytes) !== value) throw new TypeError('invalid Sites UTF-8 text');
  return bytes;
}
function path(value) {
  text(value, 1, 512);
  // Exact logical keys, not URLs. Reject ambiguous local disk/URL spellings;
  // this deliberately excludes some otherwise legal KV keys and filenames.
  if (/[\u0000-\u001f\u007f-\u009f\ufeff\\%:?#]/u.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith(' ') || part.endsWith(' ')))
    throw new TypeError('invalid Sites relative path');
  return value;
}

// Opaque immutable snapshot: callers cannot mutate or forge the private mapping.
// Supply a trusted deployment manifest: structure is not mapping authorization.
// JSON duplicate-key semantics follow JS; this is not a production hash verifier.
export function parseSitesManifest(json) {
  const parsed = parseBoundedJson(text(json, 1, maximum));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('invalid Sites manifest');
  const keys = Object.keys(parsed);
  if (keys.length > 1024) throw new RangeError('Sites manifest exceeds entry limit');
  const entries = new Map();
  for (const logical of keys) {
    path(logical);
    const physical = parsed[logical]; text(physical, 1, 512);
    if (physical.startsWith(localPrefix)) {
      if (physical !== localPrefix + encodeURIComponent(logical)) throw new TypeError('invalid Sites local mapping');
    } else path(physical);
    entries.set(logical, physical);
  }
  const token = Object.freeze({}); manifests.set(token, entries); return token;
}

// Only manifest-selected get(key, 'stream'). No raw-key fallback, list, mutation,
// MIME/cache/range logic or URL normalization. Limits do not bound upstream work.
export async function performSitesGet(binding, manifest, key, body, options, signal) {
  path(key);
  if (!(body instanceof Uint8Array) || body.length || typeof options !== 'string' ||
      /^[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options || Number(options) > 60000)
    throw new TypeError('invalid Sites read options');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Sites read signal');
  signal?.throwIfAborted();
  const entries = manifests.get(manifest);
  if (!entries) throw new TypeError('invalid Sites manifest token');
  const physical = entries.get(key);
  if (physical === undefined) return { status: 1, bytes: new Uint8Array() };
  const invoke = binding?.get;
  if (typeof invoke !== 'function') throw new TypeError('Sites namespace get unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    // Cancel late/unconsumed streams too. Locked streams are canceled by the
    // readBounded reader's abort handler; never await producer cleanup here.
    if (value instanceof ReadableStream) {
      try { void Promise.resolve(Reflect.apply(cancelStream, value, ['Sites read scope closed'])).catch(() => {}); } catch {}
    }
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Sites disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    if (value !== binding && value !== null && ['object', 'function'].includes(typeof value)) {
      if (closed || controller.signal.aborted) dispose(value); else owned.add(value);
    }
    return value;
  };
  const abort = () => { releaseAll(); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('Sites read deadline exceeded', 'TimeoutError')), Number(options));
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, binding, [physical, 'stream']));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        if (value === null) return { status: 1, bytes: new Uint8Array() };
        if (!(value instanceof ReadableStream)) throw new TypeError('invalid Sites read stream');
        const bytes = await readBounded(value, maximum, controller.signal);
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
