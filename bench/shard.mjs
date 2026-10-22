// Shared definitions for the I/O fan-out workload: the bytes the origin serves
// for one shard, and the FNV-1a checksum gateways compute over them.

export function shardBytes(seed, id, length) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) bytes[index] = (index * 7 + id * 31 + seed * 13 + (index >> 9)) & 255;
  return bytes;
}

export function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
  return hash;
}
