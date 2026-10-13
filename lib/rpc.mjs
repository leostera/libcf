import { encodeBoundedJson, parseBoundedJson } from './json.mjs';

const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype),
  'prototype', 'dup', 'then', 'fetch', 'connect', 'alarm', 'webSocketMessage', 'webSocketClose', 'webSocketError']);
export async function performRpc(method, binding, name, body, options, signal) {
  if (method !== 304 || typeof name !== 'string' || /^[A-Za-z][A-Za-z0-9_]{0,99}$/.exec(name)?.[0] !== name ||
      reserved.has(name) || options !== '') throw new TypeError('invalid RPC method');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid RPC signal');
  const args = parseBoundedJson(body);
  if (!Array.isArray(args) || args.length > 32) throw new TypeError('RPC requires at most 32 JSON arguments');
  signal?.throwIfAborted();
  const invoke = binding?.[name];
  if (typeof invoke !== 'function') throw new TypeError('RPC method unavailable');
  const pending = Reflect.apply(invoke, binding, args);
  const disposed = new Set();
  let disposalFailure;
  function disposeOnce(value) {
    if (value === null || !['object', 'function'].includes(typeof value) || disposed.has(value)) return;
    disposed.add(value);
    const dispose = value[Symbol.dispose];
    if (dispose !== undefined && typeof dispose !== 'function') throw new TypeError('invalid RPC disposer');
    if (dispose) Reflect.apply(dispose, value, []);
  }
  const onAbort = () => {
    // Event listeners must not throw into an unrelated request. Disposing an
    // RPC promise does not guarantee cancellation: still drain its late value.
    try { disposeOnce(pending); } catch (error) { disposalFailure = error; }
  };
  try {
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const value = await pending;
    try {
      signal?.throwIfAborted();
      return { status: 0, bytes: encodeBoundedJson(value, { allowRootDisposer: true }) };
    } finally { disposeOnce(value); }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    disposeOnce(pending);
    if (disposalFailure) throw disposalFailure;
  }
}
