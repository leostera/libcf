// Original synthetic GIF89a: two 16x16 opaque frames (red, then blue), 100 ms each.
// Reset the LZW dictionary before every pixel: inefficient but tiny, deterministic
// and independent of host encoders, downloads, accounts or copyrighted footage.
export function syntheticVideo() {
  const bytes = [...new TextEncoder().encode('GIF89a'), 16, 0, 16, 0, 0xf0, 0, 0,
    255, 0, 0, 0, 0, 255];
  for (const color of [0, 1]) {
    bytes.push(0x21, 0xf9, 4, 4, 10, 0, 0, 0); // Graphic control, 10 centiseconds.
    bytes.push(0x2c, 0, 0, 0, 0, 16, 0, 16, 0, 0); // Full-canvas image descriptor.
    const compressed = [];
    let bits = 0, count = 0;
    const code = value => {
      bits |= value << count;
      count += 3;
      while (count >= 8) {
        compressed.push(bits & 255);
        bits >>>= 8;
        count -= 8;
      }
    };
    for (let pixel = 0; pixel < 256; ++pixel) { code(4); code(color); }
    code(5);
    if (count) compressed.push(bits);
    // Each frame has 193 compressed bytes, within one GIF data sub-block.
    bytes.push(2, compressed.length, ...compressed, 0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}
