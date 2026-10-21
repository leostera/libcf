#pragma once

// Compute kernels for the benchmark fixture. bench/oracle.mjs defines the exact
// results; bench/rust/src/kernels.rs implements the same algorithms with the
// same explicit SIMD. Without -msimd128 the scalar loops handle every pixel.

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

namespace bench {

// Parses `?a=1&b=2` with exactly the named keys, each once, as canonical decimals.
template <std::size_t N>
std::optional<std::array<int, N>> parse_query(std::string_view url,
                                              const std::array<std::string_view, N>& names) {
  const auto start = url.find('?');
  std::string_view query = start == std::string_view::npos ? "" : url.substr(start + 1);
  query = query.substr(0, query.find('#'));
  std::array<int, N> values{};
  std::array<bool, N> seen{};
  std::size_t parts = 0;
  // Every '&'-separated part must be a pair, so "a=1&" and "&a=1" are rejected.
  for (bool more = !query.empty(); more;) {
    const auto end = query.find('&');
    const auto part = query.substr(0, end);
    more = end != std::string_view::npos;
    if (more) query.remove_prefix(end + 1);
    const auto equals = part.find('=');
    if (equals == std::string_view::npos) return std::nullopt;
    const auto key = part.substr(0, equals), digits = part.substr(equals + 1);
    if (digits.empty() || digits.size() > 6 || (digits.size() > 1 && digits[0] == '0')) return std::nullopt;
    int value = 0;
    for (char c : digits) {
      if (c < '0' || c > '9') return std::nullopt;
      value = value * 10 + (c - '0');
    }
    std::size_t index = 0;
    while (index < N && names[index] != key) ++index;
    if (index == N || seen[index]) return std::nullopt;
    seen[index] = true;
    values[index] = value;
    ++parts;
  }
  if (parts != N) return std::nullopt;
  return values;
}

inline bool valid_image(int w, int h, std::size_t length) {
  return w >= 7 && w <= 2048 && h >= 7 && h <= 2048 &&
         length == static_cast<std::size_t>(w) * static_cast<std::size_t>(h);
}

inline bool valid_search(int n, int d, int q, int k, std::size_t length) {
  return n >= 1 && n <= 32768 && d >= 16 && d <= 256 && d % 16 == 0 && q >= 1 && q <= 16 &&
         k >= 1 && k <= 100 && k <= n &&
         length == static_cast<std::size_t>(n + q) * static_cast<std::size_t>(d);
}

namespace detail {

// rows[x] = p[x-2] + 4p[x-1] + 6p[x] + 4p[x+1] + p[x+2], for 2 <= x <= w-3.
inline void horizontal(const std::uint8_t* pixels, int w, int h, std::uint16_t* rows) {
  for (int y = 0; y < h; ++y) {
    const std::uint8_t* in = pixels + static_cast<std::size_t>(y) * w;
    std::uint16_t* out = rows + static_cast<std::size_t>(y) * w;
    int x = 2;
#if defined(__wasm_simd128__)
    for (; x + 8 <= w - 2; x += 8) {
      const v128_t a0 = wasm_u16x8_load8x8(in + x - 2), a1 = wasm_u16x8_load8x8(in + x - 1);
      const v128_t a2 = wasm_u16x8_load8x8(in + x), a3 = wasm_u16x8_load8x8(in + x + 1);
      const v128_t a4 = wasm_u16x8_load8x8(in + x + 2);
      const v128_t outer = wasm_i16x8_add(a0, a4);
      const v128_t inner = wasm_i16x8_shl(wasm_i16x8_add(a1, a3), 2);
      const v128_t centre = wasm_i16x8_add(wasm_i16x8_shl(a2, 2), wasm_i16x8_shl(a2, 1));
      wasm_v128_store(out + x, wasm_i16x8_add(wasm_i16x8_add(outer, inner), centre));
    }
#endif
    for (; x <= w - 3; ++x)
      out[x] = static_cast<std::uint16_t>(in[x - 2] + in[x + 2] + 4 * (in[x - 1] + in[x + 1]) + 6 * in[x]);
  }
}

// blur = (vertical 1-4-6-4-1 of rows + 128) >> 8, for the interior 2-pixel border.
// The sum is at most 255 * 256, so 16-bit lanes never overflow.
inline void vertical(const std::uint16_t* rows, int w, int h, std::uint16_t* blur) {
  for (int y = 2; y <= h - 3; ++y) {
    const std::uint16_t* r0 = rows + static_cast<std::size_t>(y - 2) * w;
    const std::uint16_t* r1 = r0 + w;
    const std::uint16_t* r2 = r1 + w;
    const std::uint16_t* r3 = r2 + w;
    const std::uint16_t* r4 = r3 + w;
    std::uint16_t* out = blur + static_cast<std::size_t>(y) * w;
    int x = 2;
#if defined(__wasm_simd128__)
    const v128_t half = wasm_i16x8_splat(128);
    for (; x + 8 <= w - 2; x += 8) {
      const v128_t a0 = wasm_v128_load(r0 + x), a1 = wasm_v128_load(r1 + x);
      const v128_t a2 = wasm_v128_load(r2 + x), a3 = wasm_v128_load(r3 + x);
      const v128_t a4 = wasm_v128_load(r4 + x);
      const v128_t sum = wasm_i16x8_add(
          wasm_i16x8_add(wasm_i16x8_add(a0, a4), wasm_i16x8_shl(wasm_i16x8_add(a1, a3), 2)),
          wasm_i16x8_add(wasm_i16x8_shl(a2, 2), wasm_i16x8_shl(a2, 1)));
      wasm_v128_store(out + x, wasm_u16x8_shr(wasm_i16x8_add(sum, half), 8));
    }
#endif
    for (; x <= w - 3; ++x) {
      const unsigned sum = r0[x] + r4[x] + 4u * (r1[x] + r3[x]) + 6u * r2[x];
      out[x] = static_cast<std::uint16_t>((sum + 128) >> 8);
    }
  }
}

// out = min(255, |gx| + |gy|) inside the 3-pixel border; `out` is pre-zeroed.
inline void sobel(const std::uint16_t* blur, int w, int h, std::uint8_t* output) {
  for (int y = 3; y <= h - 4; ++y) {
    const std::uint16_t* top = blur + static_cast<std::size_t>(y - 1) * w;
    const std::uint16_t* mid = top + w;
    const std::uint16_t* bot = mid + w;
    std::uint8_t* out = output + static_cast<std::size_t>(y) * w;
    int x = 3;
#if defined(__wasm_simd128__)
    for (; x + 8 <= w - 3; x += 8) {
      const v128_t tl = wasm_v128_load(top + x - 1), tc = wasm_v128_load(top + x), tr = wasm_v128_load(top + x + 1);
      const v128_t ml = wasm_v128_load(mid + x - 1), mr = wasm_v128_load(mid + x + 1);
      const v128_t bl = wasm_v128_load(bot + x - 1), bc = wasm_v128_load(bot + x), br = wasm_v128_load(bot + x + 1);
      const v128_t left = wasm_i16x8_add(wasm_i16x8_add(tl, bl), wasm_i16x8_shl(ml, 1));
      const v128_t right = wasm_i16x8_add(wasm_i16x8_add(tr, br), wasm_i16x8_shl(mr, 1));
      const v128_t upper = wasm_i16x8_add(wasm_i16x8_add(tl, tr), wasm_i16x8_shl(tc, 1));
      const v128_t lower = wasm_i16x8_add(wasm_i16x8_add(bl, br), wasm_i16x8_shl(bc, 1));
      const v128_t magnitude = wasm_i16x8_add(wasm_i16x8_abs(wasm_i16x8_sub(right, left)),
                                              wasm_i16x8_abs(wasm_i16x8_sub(lower, upper)));
      // Unsigned saturation is the min(255, ...) clamp.
      wasm_v128_store64_lane(out + x, wasm_u8x16_narrow_i16x8(magnitude, magnitude), 0);
    }
#endif
    for (; x <= w - 4; ++x) {
      const int gx = top[x + 1] + 2 * mid[x + 1] + bot[x + 1] - top[x - 1] - 2 * mid[x - 1] - bot[x - 1];
      const int gy = bot[x - 1] + 2 * bot[x] + bot[x + 1] - top[x - 1] - 2 * top[x] - top[x + 1];
      const int magnitude = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      out[x] = static_cast<std::uint8_t>(magnitude > 255 ? 255 : magnitude);
    }
  }
}

// Dot product of two int16 vectors of `dimension` values (a multiple of 16).
inline std::int32_t dot(const std::int16_t* a, const std::int16_t* b, int dimension) {
#if defined(__wasm_simd128__)
  v128_t acc0 = wasm_i32x4_splat(0), acc1 = wasm_i32x4_splat(0);
  for (int index = 0; index < dimension; index += 16) {
    acc0 = wasm_i32x4_add(acc0, wasm_i32x4_dot_i16x8(wasm_v128_load(a + index), wasm_v128_load(b + index)));
    acc1 = wasm_i32x4_add(acc1, wasm_i32x4_dot_i16x8(wasm_v128_load(a + index + 8), wasm_v128_load(b + index + 8)));
  }
  const v128_t acc = wasm_i32x4_add(acc0, acc1);
  return wasm_i32x4_extract_lane(acc, 0) + wasm_i32x4_extract_lane(acc, 1) +
         wasm_i32x4_extract_lane(acc, 2) + wasm_i32x4_extract_lane(acc, 3);
#else
  std::int32_t sum = 0;
  for (int index = 0; index < dimension; ++index) sum += a[index] * b[index];
  return sum;
#endif
}

inline void widen(const std::uint8_t* bytes, int count, std::int16_t* out) {
  for (int index = 0; index < count; ++index) out[index] = static_cast<std::int8_t>(bytes[index]);
}

// Sorted top-k: descending score, earlier (smaller) ids first on ties.
struct TopK {
  std::array<std::int32_t, 100> scores;
  std::array<std::uint32_t, 100> ids;
  int filled = 0;

  void offer(std::int32_t score, std::uint32_t id, int k) {
    if (filled == k && score <= scores[k - 1]) return;
    int position = filled < k ? filled++ : k - 1;
    while (position > 0 && scores[position - 1] < score) {
      scores[position] = scores[position - 1];
      ids[position] = ids[position - 1];
      --position;
    }
    scores[position] = score;
    ids[position] = id;
  }
};

inline void put_u32(std::uint8_t* out, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) *out++ = static_cast<std::uint8_t>(value >> shift);
}

}  // namespace detail

// Writes the edge mask of a w*h image (pre-validated) into `output` (w*h bytes, zeroed).
inline void image(const std::uint8_t* pixels, int w, int h, std::uint8_t* output) {
  static std::vector<std::uint16_t> rows, blur;  // reused scratch; requests run one at a time
  const auto size = static_cast<std::size_t>(w) * h;
  if (rows.size() < size) {
    rows.resize(size);
    blur.resize(size);
  }
  detail::horizontal(pixels, w, h, rows.data());
  detail::vertical(rows.data(), w, h, blur.data());
  detail::sobel(blur.data(), w, h, output);
}

// Writes q*k result records (pre-validated input) into `output` (q*k*8 bytes).
inline void search(const std::uint8_t* input, int n, int d, int q, int k, std::uint8_t* output) {
  static std::vector<std::int16_t> queries, candidate;
  queries.resize(static_cast<std::size_t>(q) * d);
  candidate.resize(static_cast<std::size_t>(d));
  detail::widen(input + static_cast<std::size_t>(n) * d, q * d, queries.data());
  std::array<detail::TopK, 16> best;
  // One pass over the candidates; each is widened once and scored against every query.
  for (int id = 0; id < n; ++id) {
    detail::widen(input + static_cast<std::size_t>(id) * d, d, candidate.data());
    for (int query = 0; query < q; ++query)
      best[query].offer(detail::dot(candidate.data(), queries.data() + static_cast<std::size_t>(query) * d, d),
                        static_cast<std::uint32_t>(id), k);
  }
  for (int query = 0; query < q; ++query) {
    for (int rank = 0; rank < k; ++rank) {
      std::uint8_t* record = output + (static_cast<std::size_t>(query) * k + rank) * 8;
      detail::put_u32(record, best[query].ids[rank]);
      detail::put_u32(record + 4, static_cast<std::uint32_t>(best[query].scores[rank]));
    }
  }
}

}  // namespace bench
