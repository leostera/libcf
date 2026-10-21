// Reference implementations of the compute workloads, written for clarity, not
// speed. They define the expected bytes for every fixture. The workloads follow
// the published specification of bitemyapp/workerd-compute-bench (re-implemented
// here; no code is copied from that project).

// Deterministic xorshift32 stream.
function random(seed) {
  let state = (seed * 2654435761 + 1) >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
}

// A grayscale image with gradients, hard edges and noise.
export function makeImage(width, height, seed) {
  const next = random(seed);
  const pixels = new Uint8Array(width * height);
  const cx = width * (0.3 + (seed % 5) * 0.1);
  const cy = height * 0.5;
  const radius = Math.min(width, height) / 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = ((x * 160) / width + (y * 64) / height) | 0;
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius * radius) value = 255 - value;
      if (((x >> 5) + (y >> 5) + seed) % 7 === 0) value >>= 1;
      value += (next() & 31) - 16;
      pixels[y * width + x] = Math.max(0, Math.min(255, value));
    }
  }
  return pixels;
}

// `count` signed int8 vectors of `dimension` values, then returned as raw bytes.
// `spread` limits the magnitude, which makes score ties likely for small values.
export function makeVectors(count, dimension, seed, spread = 128) {
  const next = random(seed);
  const bytes = new Uint8Array(count * dimension);
  for (let index = 0; index < bytes.length; index++) {
    const value = spread === 128 ? (next() & 255) - 128 : (next() % (2 * spread + 1)) - spread;
    bytes[index] = value & 255;
  }
  return bytes;
}

const GAUSS = [1, 4, 6, 4, 1];

// 5x5 binomial blur (outer product of GAUSS, rounded half-up after both passes),
// then Sobel magnitude min(255, |gx| + |gy|). The outer three rows and columns are zero.
export function imageReference(pixels, width, height) {
  const blur = new Uint16Array(width * height);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let sum = 0;
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) sum += GAUSS[i] * GAUSS[j] * pixels[(y + i - 2) * width + x + j - 2];
      blur[y * width + x] = Math.floor((sum + 128) / 256);
    }
  }
  const at = (x, y) => blur[y * width + x];
  const output = new Uint8Array(width * height);
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      output[y * width + x] = Math.min(255, Math.abs(gx) + Math.abs(gy));
    }
  }
  return output;
}

// Exact maximum-inner-product search. For each query: `k` records of
// [candidate id: u32 LE][score: i32 LE], descending score, ascending id on ties.
export function searchReference(input, count, dimension, queries, k) {
  const values = new Int8Array(input.buffer, input.byteOffset, input.byteLength);
  const output = new Uint8Array(queries * k * 8);
  const view = new DataView(output.buffer);
  for (let query = 0; query < queries; query++) {
    const base = (count + query) * dimension;
    const scored = [];
    for (let id = 0; id < count; id++) {
      let score = 0;
      for (let index = 0; index < dimension; index++) score += values[id * dimension + index] * values[base + index];
      scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    for (let rank = 0; rank < k; rank++) {
      view.setUint32((query * k + rank) * 8, scored[rank].id, true);
      view.setInt32((query * k + rank) * 8 + 4, scored[rank].score, true);
    }
  }
  return output;
}
