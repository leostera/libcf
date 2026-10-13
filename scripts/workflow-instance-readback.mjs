import { setTimeout as delay } from 'node:timers/promises';

const identifier = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/;
function parseIds(values) {
  if (!Array.isArray(values) || values.length > 100) throw new TypeError('invalid instance page');
  const ids = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || identifier.exec(value)?.[0] !== value || ids.has(value))
      throw new TypeError('invalid or duplicate instance identity');
    ids.add(value);
  }
  return ids;
}

export function parseInstancePage(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length > 100) throw new TypeError('invalid instance page');
  return parseIds(rows.map(row => row?.id));
}

// The owned definition starts empty and this probe creates at most 100 IDs.
// Exact presence before deletion prevents an always-empty/wrong listing from
// becoming false deletion evidence. An empty unfiltered first page proves
// API absence; it does not prove physical storage erasure. The list callback
// must honor the supplied signal (the live caller uses bounded execFile).
export async function waitForInstanceReadback(list, ownedIds, {
  phase, signal, retryMs = 1000,
}) {
  const owned = parseIds(ownedIds);
  if (!owned.size || !['present', 'absent'].includes(phase) || !(signal instanceof AbortSignal) ||
      !Number.isInteger(retryMs) || retryMs < 1 || retryMs > 10000)
    throw new TypeError('invalid instance readback configuration');
  while (true) {
    signal.throwIfAborted();
    const observed = parseInstancePage(await list(signal));
    signal.throwIfAborted();
    if ([...observed].some(id => !owned.has(id))) throw new Error('unexpected instance in isolated definition');
    if (phase === 'present' ? observed.size === owned.size : observed.size === 0)
      return [...observed];
    await delay(retryMs, undefined, { signal });
  }
}
