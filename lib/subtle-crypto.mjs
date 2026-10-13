const lengths = new Map([['SHA-256', 32], ['SHA-384', 48], ['SHA-512', 64]]);
export async function performDigest(algorithm, input, subtle) {
  const length = lengths.get(algorithm);
  if (length === undefined) throw new TypeError('unsupported digest algorithm');
  if (!(input instanceof Uint8Array) || input.byteLength > 1048576)
    throw new RangeError('digest requires at most 1 MiB of bytes');
  const result = await subtle.digest(algorithm, input);
  if (!(result instanceof ArrayBuffer) || result.byteLength !== length)
    throw new TypeError('invalid digest result');
  return { status: 0, bytes: new Uint8Array(result) };
}
