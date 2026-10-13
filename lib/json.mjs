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
