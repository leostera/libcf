import { parseBoundedJson } from './json.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const replyLimit = 1048576;

function text(value, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum)
    throw new TypeError('invalid Analytics SQL text');
  const bytes = encoder.encode(value);
  if (bytes.length < minimum || bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new TypeError('invalid Analytics SQL UTF-8 text');
  return bytes;
}
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
    throw new TypeError('unsafe Analytics SQL number; use text for large integers');
  return value;
}
function parameter(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return number(value);
  text(value, 0, 4096); return value;
}
function parseRequest(query, body, options) {
  text(query, 1, 10240);
  if (!(body instanceof Uint8Array) || body.byteLength > 65536 || typeof options !== 'string')
    throw new TypeError('invalid Analytics SQL request');
  const match = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,4})$/.exec(options);
  if (!match || match[0] !== options) throw new TypeError('invalid Analytics SQL request');
  const rowLimit = Number(match[1]), timeout = Number(match[2]);
  if (rowLimit > 100 || timeout > 60000) throw new RangeError('invalid Analytics SQL limit');
  const request = { query };
  if (body.length) {
    // Parse before yielding: own all values, never retain caller-owned bytes.
    const params = parseBoundedJson(body);
    if (Array.isArray(params)) {
      if (params.length > 100) throw new RangeError('too many Analytics SQL parameters');
      request.params = params.map(parameter);
    } else {
      if (params === null || typeof params !== 'object') throw new TypeError('invalid Analytics SQL parameters');
      const keys = Object.keys(params);
      if (keys.length > 100) throw new RangeError('too many Analytics SQL parameters');
      // workerd RPC requires an ordinary object; define own data properties so
      // names such as __proto__ cannot invoke inherited setters.
      request.params = {};
      for (const key of keys) {
        if (key.length > 64 || /^[A-Za-z_][A-Za-z0-9_]*$/.exec(key)?.[0] !== key)
          throw new TypeError('invalid Analytics SQL parameter name');
        Object.defineProperty(request.params, key, { value: parameter(params[key]), enumerable: true, writable: true, configurable: true });
      }
    }
  }
  return { request, rowLimit, timeout };
}
function encodeResult(value, rowLimit) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid Analytics SQL result');
  const data = value.data, rows = value.rows, statistics = value.statistics;
  if (!Array.isArray(data) || Object.getPrototypeOf(data) !== Array.prototype || !Number.isInteger(rows) || rows < 0 || rows > rowLimit || data.length !== rows ||
      statistics === null || typeof statistics !== 'object' || Array.isArray(statistics)) throw new TypeError('invalid Analytics SQL result');
  const elapsed = statistics.elapsed_ms, rowsRead = statistics.rows_read, bytesRead = statistics.bytes_read;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(rowsRead) || rowsRead < 0 || !Number.isSafeInteger(bytesRead) || bytesRead < 0)
    throw new TypeError('invalid Analytics SQL statistics');
  const parts = []; let size = 0;
  const append = bytes => {
    if (bytes.length > replyLimit - size) throw new RangeError('Analytics SQL result exceeds byte limit');
    size += bytes.length; parts.push(bytes);
  };
  const u32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); append(bytes); };
  const f64 = value => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); append(bytes); };
  const u64 = value => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true); append(bytes); };
  const string = value => { u32(value.length); append(value); };
  u32(rows); f64(elapsed); u64(rowsRead); u64(bytesRead);
  for (let i = 0; i < rows; ++i) {
    const descriptor = Object.getOwnPropertyDescriptor(data, String(i));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('invalid Analytics SQL row');
    const row = descriptor.value;
    if (row === null || typeof row !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) throw new TypeError('invalid Analytics SQL row');
    const keys = Reflect.ownKeys(row);
    if (keys.length > 64) throw new RangeError('too many Analytics SQL columns');
    u32(keys.length);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('invalid Analytics SQL cell');
      string(text(key, 1, 128));
      const cell = descriptor.value;
      if (cell === null) u32(0);
      else if (cell === false) u32(1);
      else if (cell === true) u32(2);
      else if (typeof cell === 'number') { u32(3); f64(number(cell)); }
      else { u32(4); string(text(cell, 0, 4096)); }
    }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { status: 0, bytes };
}

// A row projection limit is not a SQL LIMIT, access policy or scan-cost bound.
// No SQL rewrite, account predicates, retry or native cancellation is implied.
export async function performAnalyticsSql(binding, query, body, options, signal) {
  const { request, rowLimit, timeout } = parseRequest(query, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Analytics SQL signal');
  signal?.throwIfAborted();
  const invoke = binding?.query;
  if (typeof invoke !== 'function') throw new TypeError('Analytics SQL query unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Analytics SQL disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
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
  const timer = setTimeout(() => controller.abort(new DOMException('Analytics SQL deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, binding, [request]));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodeResult(value, rowLimit);
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
