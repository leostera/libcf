import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export const rotatedPixels = [255,0,0,255,255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255,0,255,0,255];

// Independent tiny non-interlaced PNG decoder for the 3x2 rotation fixture.
// This test helper is not a general image decoder or a library API.
export function decodeTinyPng(bytes) {
  assert(bytes.length <= 4096); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const data = []; let offset = 8, width, height, channels, ended = false;
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length);
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert(offset + 12 + size <= bytes.length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) {
      crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + size));
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      assert.equal(offset, 8); assert.equal(size, 13);
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(width, 3); assert.equal(height, 2); assert.equal(chunk[8], 8);
      assert([2, 6].includes(chunk[9])); channels = chunk[9] === 6 ? 4 : 3;
      assert.deepEqual([...chunk.subarray(10)], [0, 0, 0]);
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') { assert.equal(size, 0); assert.equal(offset + 12, bytes.length); ended = true; }
    offset += 12 + size;
  }
  assert(ended && data.length && channels);
  const stride = width * channels, filtered = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  assert.equal(filtered.length, (stride + 1) * height);
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? raw[y * stride + x - channels] : 0, b = y ? raw[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? raw[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[y * stride + x] = filtered[y * (stride + 1) + 1 + x] + predictor;
    }
  }
  const rgba = [];
  for (let i = 0; i < raw.length; i += channels) rgba.push(raw[i], raw[i + 1], raw[i + 2], channels === 4 ? raw[i + 3] : 255);
  return rgba;
}
