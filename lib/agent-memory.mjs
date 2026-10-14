const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const types = new Map([['fact', 0], ['event', 1], ['instruction', 2], ['task', 3]]);
const recordLimit = 4324;
const dateLimit = 8640000000000000;

function parseRequest(key, body, options) {
  if (typeof key !== 'string' || /^[A-Za-z0-9_-]{1,100}$/.exec(key)?.[0] !== key ||
      !(body instanceof Uint8Array) || body.byteLength > 2048 || typeof options !== 'string' ||
      /^[1-9][0-9]?:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Agent Memory list request');
  const [count, timeout] = options.split(':').map(Number);
  if (count > 50 || timeout > 60000) throw new RangeError('invalid Agent Memory list limits');
  return { count, timeout, cursor: body.byteLength ? decoder.decode(body) : undefined };
}

function text(value, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum)
    throw new TypeError('invalid Agent Memory text');
  const bytes = encoder.encode(value);
  if (bytes.length < minimum || bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new TypeError('invalid Agent Memory UTF-8 text');
  return bytes;
}

function milliseconds(value) {
  if (!(value instanceof Date)) throw new TypeError('invalid Agent Memory date');
  // Do not invoke user overrides/toJSON, or convert milliseconds to nanoseconds.
  const time = Date.prototype.getTime.call(value);
  if (!Number.isSafeInteger(time) || Math.abs(time) > dateLimit) throw new TypeError('invalid Agent Memory date');
  return time;
}

function encodePage(value, count) {
  const memories = value?.memories, cursorValue = value?.cursor;
  if (!Array.isArray(memories)) throw new TypeError('invalid Agent Memory page');
  const length = memories.length;
  if (!Number.isInteger(length) || length < 0 || length > count) throw new TypeError('invalid Agent Memory count');
  const cursor = cursorValue === undefined ? undefined : text(cursorValue, 1, 2048);
  const records = [];
  for (let i = 0; i < length; ++i) {
    const memory = memories[i];
    if (memory === null || typeof memory !== 'object' || Array.isArray(memory)) throw new TypeError('invalid Agent Memory record');
    const type = types.get(memory.type), session = memory.sessionId;
    if (type === undefined) throw new TypeError('invalid Agent Memory type');
    records.push({ id: text(memory.id, 1, 128), type, summary: text(memory.summary, 0, 4096),
      session: session === null ? null : text(session, 0, 64),
      created: milliseconds(memory.createdAt), updated: milliseconds(memory.updatedAt) });
  }
  const size = 8 + (cursor ? 4 + cursor.length : 0) + records.reduce((total, record) =>
    total + 32 + record.id.length + record.summary.length + (record.session === null ? 0 : 4 + record.session.length), 0);
  if (size > 2060 + count * recordLimit) throw new RangeError('Agent Memory reply exceeds limit');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let offset = 0;
  const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
  const string = value => { u32(value.length); bytes.set(value, offset); offset += value.length; };
  const optional = value => { u32(value == null ? 0 : 1); if (value != null) string(value); };
  u32(records.length); optional(cursor);
  for (const record of records) {
    string(record.id); u32(record.type); string(record.summary); optional(record.session);
    view.setBigInt64(offset, BigInt(record.created), true);
    view.setBigInt64(offset + 8, BigInt(record.updated), true); offset += 16;
  }
  return { status: 0, bytes };
}

// getProfile CREATES missing profiles. This is not a read-only existence check.
export async function performAgentMemoryListCreatingProfile(binding, key, body, options, signal) {
  const { count, timeout, cursor } = parseRequest(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Agent Memory signal');
  signal?.throwIfAborted();
  const acquire = binding?.getProfile;
  if (typeof acquire !== 'function') throw new TypeError('Agent Memory binding unavailable');
  const controller = new AbortController();
  const owned = new Set(), disposed = new WeakSet();
  let closed = false, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const dispose = value => {
    owned.delete(value);
    if (disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Agent Memory disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const releaseAll = () => { for (const value of [...owned].reverse()) dispose(value); };
  const own = value => {
    // Four owned roots at most. No profile deletion is requested; releasing
    // leases cannot undo creation, including completion after cancellation.
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
  const timer = setTimeout(() => controller.abort(new DOMException('Agent Memory deadline exceeded', 'TimeoutError')), timeout);
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
        const profile = own(await acquisition);
        controller.signal.throwIfAborted();
        const invoke = profile?.list;
        if (typeof invoke !== 'function') throw new TypeError('Agent Memory profile list unavailable');
        controller.signal.throwIfAborted();
        const pending = own(Reflect.apply(invoke, profile, [{ limit: count, ...(cursor === undefined ? {} : { cursor }) }]));
        const value = own(await pending);
        controller.signal.throwIfAborted();
        return encodePage(value, count);
      } finally { releaseAll(); }
    });
    const result = await Promise.race([observed, canceled]);
    controller.signal.throwIfAborted();
    succeeded = true;
    return result;
  } finally {
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', abort);
    releaseAll();
    if (succeeded && cleanupFailed) throw cleanupError;
  }
}
