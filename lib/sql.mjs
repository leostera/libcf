const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const limit = 4 * 1024 * 1024;

export function parseParameters(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  function take(size) {
    if (size > bytes.length - offset) throw new TypeError('truncated SQL parameters');
    const start = offset;
    offset += size;
    return start;
  }
  const u32 = () => view.getUint32(take(4), true);
  const field = () => { const length = u32(); const start = take(length); return bytes.slice(start, start + length); };
  const count = u32();
  if (count > 100) throw new RangeError('too many SQL parameters');
  const values = [];
  for (let i = 0; i < count; i++) {
    switch (u32()) {
      case 0: values.push(null); break;
      case 1: {
        const value = view.getFloat64(take(8), true);
        if (!Number.isFinite(value)) throw new TypeError('invalid SQL number');
        values.push(value);
        break;
      }
      case 2: values.push(decoder.decode(field())); break;
      case 3: values.push(field().buffer); break;
      default: throw new TypeError('invalid SQL parameter tag');
    }
  }
  if (offset !== bytes.length) throw new TypeError('trailing SQL parameter bytes');
  return values;
}

export function encodeResult(result) {
  const parts = [];
  let length = 0;
  function append(bytes) {
    length += bytes.length;
    if (length > limit) throw new RangeError('D1 result exceeds 4 MiB bridge limit');
    parts.push(bytes);
  }
  function u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    append(bytes);
  }
  function field(bytes) { u32(bytes.length); append(bytes); }
  function text(value) { field(encoder.encode(value)); }
  function scalar(value) {
    if (value === null) { u32(0); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
        throw new TypeError('D1 number cannot be represented safely; cast large integers to TEXT');
      u32(1);
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, value, true);
      append(bytes);
    } else if (typeof value === 'string') {
      u32(2); text(value);
    } else if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      // D1 represents BLOB result cells as arrays of byte numbers.
      u32(3); field(Uint8Array.from(value));
    } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      u32(3);
      field(value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else {
      throw new TypeError('unsupported D1 cell type');
    }
  }
  const countBytes = new Uint8Array(4);
  append(countBytes);
  let rowCount = 0;
  for (const row of result.results ?? []) {
    rowCount++;
    const cells = Object.entries(row);
    u32(cells.length);
    for (const [name, value] of cells) { text(name); scalar(value); }
  }
  new DataView(countBytes.buffer).setUint32(0, rowCount, true);
  const meta = encoder.encode(JSON.stringify(typeof result.meta === 'function' ? result.meta() : result.meta ?? result));
  const prefix = new Uint8Array(meta.length + 4);
  new DataView(prefix.buffer).setUint32(0, meta.length, true);
  prefix.set(meta, 4);
  length += prefix.length;
  if (length > limit) throw new RangeError('SQL result exceeds 4 MiB bridge limit');
  parts.unshift(prefix);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function parseBatch(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  function u32() {
    if (bytes.length - offset < 4) throw new TypeError('truncated D1 batch');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function field() {
    const length = u32();
    if (length > bytes.length - offset) throw new TypeError('invalid D1 batch field');
    const value = bytes.slice(offset, offset + length);
    offset += length;
    return value;
  }
  const count = u32();
  if (count < 1 || count > 100) throw new RangeError('invalid D1 batch size');
  const statements = [];
  for (let i = 0; i < count; i++) {
    const sql = decoder.decode(field());
    const parameters = parseParameters(field());
    statements.push({ sql, parameters });
  }
  if (offset !== bytes.length) throw new TypeError('trailing D1 batch bytes');
  return statements;
}

export function encodeBatch(results) {
  const parts = [];
  let size = 4;
  for (const result of results) {
    const part = encodeResult(result);
    size += 4 + part.length;
    if (size > limit) throw new RangeError('SQL batch results exceed 4 MiB');
    parts.push(part);
  }
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, parts.length, true);
  let offset = 4;
  for (const part of parts) {
    view.setUint32(offset, part.length, true);
    offset += 4;
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
