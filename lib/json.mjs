const decoder = new TextDecoder('utf-8', { fatal: true });
// Parse once at the host boundary; providers receive a bounded JSON value, not
// unchecked text. Numeric precision and duplicate-key behavior follow JS JSON.
export function parseBoundedJson(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 1048576)
    throw new RangeError('JSON input must contain 1..1048576 bytes');
  const text = decoder.decode(bytes);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > 32) throw new RangeError('JSON input exceeds container depth 32');
    } else if (character === '}' || character === ']') depth--;
  }
  const value = JSON.parse(text);
  let nodes = 0;
  function visit(item) {
    if (++nodes > 65536) throw new RangeError('JSON input exceeds node limit');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('JSON number is not finite');
    if (item !== null && typeof item === 'object') {
      for (const child of Object.values(item)) visit(child);
    }
  }
  visit(value);
  return value;
}

// Serialize ordinary by-value data, not arbitrary JS objects/proxies. Ownership
// stays with the caller: allowing the native RPC root disposer does not call it.
export function encodeBoundedJson(value, { allowRootDisposer = false } = {}) {
  if (typeof allowRootDisposer !== 'boolean') throw new TypeError('invalid JSON output policy');
  const encoder = new TextEncoder();
  const parts = [];
  const ancestors = new Set();
  let bytes = 0;
  let nodes = 0;
  function append(text, byteLength = text.length) {
    // Syntax/number chunks are ASCII; quoted content supplies its UTF-8 size.
    bytes += byteLength;
    if (bytes > 1048576) throw new RangeError('JSON output exceeds byte limit');
    parts.push(text);
  }
  function quote(text) {
    if (text.length > 1048576 - bytes - 2) throw new RangeError('JSON output exceeds byte limit');
    append('"');
    // Bound temporary escaping allocations too. Splitting a surrogate pair
    // produces two JSON escapes that decode back to the same UTF-16 string.
    for (let offset = 0; offset < text.length; offset += 1024) {
      const escaped = JSON.stringify(text.slice(offset, offset + 1024)).slice(1, -1);
      append(escaped, encoder.encode(escaped).byteLength);
    }
    append('"');
  }
  function visit(item, depth) {
    if (++nodes > 65536) throw new RangeError('JSON output exceeds node limit');
    if (item === null) return append('null');
    if (typeof item === 'string') return quote(item);
    if (typeof item === 'boolean') return append(item ? 'true' : 'false');
    if (typeof item === 'number' && Number.isFinite(item)) return append(String(item));
    if (typeof item !== 'object') throw new TypeError('unsupported JSON output value');
    if (depth >= 32) throw new RangeError('JSON output exceeds container depth 32');
    if (ancestors.has(item)) throw new TypeError('cyclic JSON output');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new TypeError('unsupported JSON output prototype');
    if (array && item.length > 65536 - nodes) throw new RangeError('JSON output exceeds node limit');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 65536 - nodes + 2) throw new RangeError('JSON output exceeds node limit');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor)) throw new TypeError('JSON output accessor');
      if (typeof key === 'symbol') {
        if (!(allowRootDisposer && depth === 0 && key === Symbol.dispose && typeof descriptor.value === 'function'))
          throw new TypeError('JSON output symbol property');
      } else if (array && key === 'length') continue;
      else if (!descriptor.enumerable || (array && (/^(0|[1-9][0-9]*)$/.exec(key)?.[0] !== key || Number(key) >= item.length)))
        throw new TypeError('unsupported JSON output property');
    }
    ancestors.add(item);
    try {
      append(array ? '[' : '{');
      const names = array ? Array.from({ length: item.length }, (_, index) => String(index)) : keys.filter(key => typeof key === 'string');
      let first = true;
      for (const key of names) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new TypeError('sparse or accessor JSON output');
        if (!first) append(',');
        first = false;
        if (!array) { quote(key); append(':'); }
        visit(descriptor.value, depth + 1);
      }
      append(array ? ']' : '}');
    } finally { ancestors.delete(item); }
  }
  visit(value, 0);
  return encoder.encode(parts.join(''));
}
