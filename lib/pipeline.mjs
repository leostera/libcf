const decoder = new TextDecoder('utf-8', { fatal: true });
export function parsePipelineBatch(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 1048576)
    throw new RangeError('JSON batch must contain 1..1048576 bytes');
  const text = decoder.decode(bytes);
  // Limit nesting before JSON.parse allocates a deeply nested graph. Syntax is
  // still decided by JSON.parse, not by this string-aware depth scan.
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
      if (++depth > 32) throw new RangeError('JSON batch exceeds container depth 32');
    } else if (character === '}' || character === ']') depth--;
  }
  const records = JSON.parse(text);
  if (!Array.isArray(records) || records.length < 1 || records.length > 1000 ||
      records.some(record => record === null || typeof record !== 'object' || Array.isArray(record)))
    throw new TypeError('expected 1..1000 JSON object records');
  let nodes = 0;
  function visit(value) {
    if (++nodes > 65536) throw new RangeError('JSON batch exceeds node limit');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('JSON number is not finite');
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  }
  visit(records);
  return records;
}
export async function performPipeline(binding, bytes) {
  const records = parsePipelineBatch(bytes);
  await binding.send(records);
  return { status: 0, bytes: new Uint8Array() };
}
