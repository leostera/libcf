// Optimized JavaScript compute kernels for the plain-JS benchmark fixture. The
// workloads are defined by bench/oracle.mjs. Each phase is its own function so
// V8 optimizes it independently: mixing phases in one loop nest caused repeated
// deoptimizations when request sizes changed.

// Parses `?a=1&b=2` with exactly the named keys, each once, as canonical decimals.
// Returns null when anything else is present.
export function parseQuery(search, names) {
  const values = {};
  const text = search.startsWith('?') ? search.slice(1) : search;
  const parts = text ? text.split('&') : [];
  if (parts.length !== names.length) return null;
  for (const part of parts) {
    const match = /^([a-z]+)=(0|[1-9][0-9]{0,5})$/.exec(part);
    if (!match || !names.includes(match[1]) || Object.hasOwn(values, match[1])) return null;
    values[match[1]] = Number(match[2]);
  }
  return values;
}

export function validImage({ w, h }, length) {
  return w >= 7 && w <= 2048 && h >= 7 && h <= 2048 && length === w * h;
}

export function validSearch({ n, d, q, k }, length) {
  return n >= 1 && n <= 32768 && d >= 16 && d <= 256 && d % 16 === 0 &&
    q >= 1 && q <= 16 && k >= 1 && k <= 100 && k <= n && length === (n + q) * d;
}

let rows = new Uint16Array(0);
let blurred = new Uint16Array(0);

function horizontal(pixels, width, height, out) {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = row + 2, end = row + width - 2; x < end; x++)
      out[x] = pixels[x - 2] + pixels[x + 2] + 4 * (pixels[x - 1] + pixels[x + 1]) + 6 * pixels[x];
  }
}

function vertical(source, width, height, out) {
  const w2 = 2 * width;
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = row + 2, end = row + width - 2; x < end; x++) {
      const sum = source[x - w2] + source[x + w2] + 4 * (source[x - width] + source[x + width]) + 6 * source[x];
      out[x] = (sum + 128) >> 8;
    }
  }
}

function sobel(blur, width, height, out) {
  for (let y = 3; y < height - 3; y++) {
    const row = y * width;
    for (let x = row + 3, end = row + width - 3; x < end; x++) {
      const tl = blur[x - width - 1], tc = blur[x - width], tr = blur[x - width + 1];
      const ml = blur[x - 1], mr = blur[x + 1];
      const bl = blur[x + width - 1], bc = blur[x + width], br = blur[x + width + 1];
      const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
      const gy = bl + 2 * bc + br - tl - 2 * tc - tr;
      const magnitude = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      out[x] = magnitude > 255 ? 255 : magnitude;
    }
  }
}

export function image(pixels, width, height) {
  const size = width * height;
  if (rows.length < size) { rows = new Uint16Array(size); blurred = new Uint16Array(size); }
  horizontal(pixels, width, height, rows);
  vertical(rows, width, height, blurred);
  const output = new Uint8Array(size);
  sobel(blurred, width, height, output);
  return output;
}

function dot(values, a, b, dimension) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let index = 0; index < dimension; index += 4) {
    s0 += values[a + index] * values[b + index];
    s1 += values[a + index + 1] * values[b + index + 1];
    s2 += values[a + index + 2] * values[b + index + 2];
    s3 += values[a + index + 3] * values[b + index + 3];
  }
  return s0 + s1 + s2 + s3;
}

// Scores every candidate for one query, keeping a sorted top-k buffer.
function rank(values, count, dimension, query, k, scores, ids) {
  let filled = 0;
  for (let id = 0; id < count; id++) {
    const score = dot(values, id * dimension, query, dimension);
    if (filled === k && score <= scores[k - 1]) continue;
    let position = filled < k ? filled++ : k - 1;
    // Strictly greater moves up, so earlier (smaller) ids win ties.
    while (position > 0 && scores[position - 1] < score) {
      scores[position] = scores[position - 1];
      ids[position] = ids[position - 1];
      position--;
    }
    scores[position] = score;
    ids[position] = id;
  }
}

export function search(input, count, dimension, queries, k) {
  const values = new Int8Array(input.buffer, input.byteOffset, input.byteLength);
  const output = new Uint8Array(queries * k * 8);
  const view = new DataView(output.buffer);
  const scores = new Int32Array(k);
  const ids = new Int32Array(k);
  for (let query = 0; query < queries; query++) {
    rank(values, count, dimension, (count + query) * dimension, k, scores, ids);
    for (let index = 0; index < k; index++) {
      view.setUint32((query * k + index) * 8, ids[index], true);
      view.setInt32((query * k + index) * 8 + 4, scores[index], true);
    }
  }
  return output;
}
