import { deflateSync } from 'node:zlib';
export function chunk(name, data) {
  const payload = Buffer.concat([Buffer.from(name), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(2); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
const pixels = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]);
export const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.concat([pixels, pixels, pixels]))), chunk('IEND', Buffer.alloc(0))]);
export const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"><rect width="7" height="9"/></svg>';
