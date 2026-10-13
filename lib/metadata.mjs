const encoder = new TextEncoder();
export function performVersionMetadata(binding) {
  const fields = [binding.id, binding.tag, binding.timestamp];
  if (fields.some(value => typeof value !== 'string') || !fields[0] || !fields[2])
    throw new TypeError('invalid version metadata');
  if (fields.reduce((sum, value) => sum + value.length + 4, 0) > 65536)
    throw new RangeError('version metadata exceeds 64 KiB');
  const encoded = fields.map(value => encoder.encode(value));
  const length = encoded.reduce((sum, bytes) => sum + bytes.length + 4, 0);
  if (length > 65536) throw new RangeError('version metadata exceeds 64 KiB');
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const field of encoded) {
    view.setUint32(offset, field.length, true);
    bytes.set(field, offset + 4);
    offset += 4 + field.length;
  }
  return { status: 0, bytes };
}
export async function performSecretsStore(binding) {
  let value;
  try { value = await binding.get(); }
  catch { throw new Error('Secrets Store read failed'); } // Never echo provider error text that might contain a value.
  if (typeof value !== 'string') throw new TypeError('invalid secret value type');
  if (value.length > 65536) throw new RangeError('secret exceeds SDK 64 KiB limit');
  const bytes = encoder.encode(value);
  if (bytes.length > 65536) throw new RangeError('secret exceeds SDK 64 KiB limit');
  return { status: 0, bytes };
}
