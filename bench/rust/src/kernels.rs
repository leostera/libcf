//! Compute kernels, mirroring bench/src/kernels.hpp: the same algorithms and the
//! same explicit Wasm SIMD. bench/oracle.mjs defines the exact results.

use std::cell::RefCell;

#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

/// Parses `a=1&b=2` (without `?`) with exactly the named keys, each once, as canonical decimals.
pub fn parse_query<const N: usize>(query: Option<&str>, names: [&str; N]) -> Option<[usize; N]> {
    let query = query.unwrap_or("");
    let mut values = [0usize; N];
    let mut seen = [false; N];
    let mut parts = 0;
    for part in query.split('&').filter(|_| !query.is_empty()) {
        let (key, digits) = part.split_once('=')?;
        let canonical = !digits.is_empty()
            && digits.len() <= 6
            && digits.bytes().all(|c| c.is_ascii_digit())
            && !(digits.len() > 1 && digits.starts_with('0'));
        if !canonical {
            return None;
        }
        let index = names.iter().position(|name| *name == key)?;
        if seen[index] {
            return None;
        }
        seen[index] = true;
        values[index] = digits.parse().ok()?;
        parts += 1;
    }
    (parts == N).then_some(values)
}

pub fn valid_image(w: usize, h: usize, length: usize) -> bool {
    (7..=2048).contains(&w) && (7..=2048).contains(&h) && length == w * h
}

pub fn valid_search(n: usize, d: usize, q: usize, k: usize, length: usize) -> bool {
    (1..=32768).contains(&n)
        && (16..=256).contains(&d)
        && d % 16 == 0
        && (1..=16).contains(&q)
        && (1..=100).contains(&k)
        && k <= n
        && length == (n + q) * d
}

fn horizontal(pixels: &[u8], w: usize, h: usize, rows: &mut [u16]) {
    for y in 0..h {
        let input = &pixels[y * w..(y + 1) * w];
        let out = &mut rows[y * w..(y + 1) * w];
        let mut x = 2;
        #[cfg(target_feature = "simd128")]
        while x + 8 <= w - 2 {
            // SAFETY: the loads read input[x-2..x+10] and the store writes out[x..x+8],
            // all within the row because x + 8 <= w - 2.
            unsafe {
                let p = input.as_ptr().add(x);
                let a0 = u16x8_load_extend_u8x8(p.sub(2));
                let a1 = u16x8_load_extend_u8x8(p.sub(1));
                let a2 = u16x8_load_extend_u8x8(p);
                let a3 = u16x8_load_extend_u8x8(p.add(1));
                let a4 = u16x8_load_extend_u8x8(p.add(2));
                let outer = i16x8_add(a0, a4);
                let inner = i16x8_shl(i16x8_add(a1, a3), 2);
                let centre = i16x8_add(i16x8_shl(a2, 2), i16x8_shl(a2, 1));
                v128_store(out.as_mut_ptr().add(x) as *mut v128, i16x8_add(i16x8_add(outer, inner), centre));
            }
            x += 8;
        }
        while x + 3 <= w {
            out[x] = u16::from(input[x - 2]) + u16::from(input[x + 2])
                + 4 * (u16::from(input[x - 1]) + u16::from(input[x + 1]))
                + 6 * u16::from(input[x]);
            x += 1;
        }
    }
}

fn vertical(rows: &[u16], w: usize, h: usize, blur: &mut [u16]) {
    for y in 2..h - 2 {
        let r = |offset: usize| &rows[(y + offset - 2) * w..(y + offset - 1) * w];
        let (r0, r1, r2, r3, r4) = (r(0), r(1), r(2), r(3), r(4));
        let out = &mut blur[y * w..(y + 1) * w];
        let mut x = 2;
        #[cfg(target_feature = "simd128")]
        {
            let half = i16x8_splat(128);
            while x + 8 <= w - 2 {
                // SAFETY: 8 lanes from x stay within each row because x + 8 <= w - 2.
                unsafe {
                    let load = |row: &[u16]| v128_load(row.as_ptr().add(x) as *const v128);
                    let (a0, a1, a2, a3, a4) = (load(r0), load(r1), load(r2), load(r3), load(r4));
                    let sum = i16x8_add(
                        i16x8_add(i16x8_add(a0, a4), i16x8_shl(i16x8_add(a1, a3), 2)),
                        i16x8_add(i16x8_shl(a2, 2), i16x8_shl(a2, 1)),
                    );
                    v128_store(out.as_mut_ptr().add(x) as *mut v128, u16x8_shr(i16x8_add(sum, half), 8));
                }
                x += 8;
            }
        }
        while x + 3 <= w {
            let sum = u32::from(r0[x]) + u32::from(r4[x])
                + 4 * (u32::from(r1[x]) + u32::from(r3[x]))
                + 6 * u32::from(r2[x]);
            out[x] = ((sum + 128) >> 8) as u16;
            x += 1;
        }
    }
}

fn sobel(blur: &[u16], w: usize, h: usize, output: &mut [u8]) {
    for y in 3..h - 3 {
        let top = &blur[(y - 1) * w..y * w];
        let mid = &blur[y * w..(y + 1) * w];
        let bot = &blur[(y + 1) * w..(y + 2) * w];
        let out = &mut output[y * w..(y + 1) * w];
        let mut x = 3;
        #[cfg(target_feature = "simd128")]
        while x + 8 <= w - 3 {
            // SAFETY: loads read [x-1, x+9) and the store writes [x, x+8), within the
            // row because x + 8 <= w - 3.
            unsafe {
                let load = |row: &[u16], at: usize| v128_load(row.as_ptr().add(at) as *const v128);
                let (tl, tc, tr) = (load(top, x - 1), load(top, x), load(top, x + 1));
                let (ml, mr) = (load(mid, x - 1), load(mid, x + 1));
                let (bl, bc, br) = (load(bot, x - 1), load(bot, x), load(bot, x + 1));
                let left = i16x8_add(i16x8_add(tl, bl), i16x8_shl(ml, 1));
                let right = i16x8_add(i16x8_add(tr, br), i16x8_shl(mr, 1));
                let upper = i16x8_add(i16x8_add(tl, tr), i16x8_shl(tc, 1));
                let lower = i16x8_add(i16x8_add(bl, br), i16x8_shl(bc, 1));
                let magnitude = i16x8_add(i16x8_abs(i16x8_sub(right, left)), i16x8_abs(i16x8_sub(lower, upper)));
                // Unsigned saturation is the min(255, ...) clamp.
                v128_store64_lane::<0>(u8x16_narrow_i16x8(magnitude, magnitude), out.as_mut_ptr().add(x) as *mut u64);
            }
            x += 8;
        }
        while x + 4 <= w {
            let at = |row: &[u16], i: usize| i32::from(row[i]);
            let gx = at(top, x + 1) + 2 * at(mid, x + 1) + at(bot, x + 1) - at(top, x - 1) - 2 * at(mid, x - 1) - at(bot, x - 1);
            let gy = at(bot, x - 1) + 2 * at(bot, x) + at(bot, x + 1) - at(top, x - 1) - 2 * at(top, x) - at(top, x + 1);
            out[x] = (gx.abs() + gy.abs()).min(255) as u8;
            x += 1;
        }
    }
}

thread_local! {
    // Reused scratch; requests run one at a time.
    static IMAGE_SCRATCH: RefCell<(Vec<u16>, Vec<u16>)> = const { RefCell::new((Vec::new(), Vec::new())) };
    static SEARCH_SCRATCH: RefCell<(Vec<i16>, Vec<i16>)> = const { RefCell::new((Vec::new(), Vec::new())) };
}

/// Returns the edge mask of a pre-validated w*h image.
pub fn image(pixels: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut output = vec![0u8; w * h];
    IMAGE_SCRATCH.with_borrow_mut(|(rows, blur)| {
        if rows.len() < w * h {
            rows.resize(w * h, 0);
            blur.resize(w * h, 0);
        }
        horizontal(pixels, w, h, rows);
        vertical(rows, w, h, blur);
        sobel(blur, w, h, &mut output);
    });
    output
}

fn dot(a: &[i16], b: &[i16]) -> i32 {
    #[cfg(target_feature = "simd128")]
    {
        let mut acc0 = i32x4_splat(0);
        let mut acc1 = i32x4_splat(0);
        for (a, b) in a.chunks_exact(16).zip(b.chunks_exact(16)) {
            // SAFETY: each chunk holds 16 i16 values (two v128).
            unsafe {
                let load = |s: &[i16], at: usize| v128_load(s.as_ptr().add(at) as *const v128);
                acc0 = i32x4_add(acc0, i32x4_dot_i16x8(load(a, 0), load(b, 0)));
                acc1 = i32x4_add(acc1, i32x4_dot_i16x8(load(a, 8), load(b, 8)));
            }
        }
        let acc = i32x4_add(acc0, acc1);
        i32x4_extract_lane::<0>(acc) + i32x4_extract_lane::<1>(acc) + i32x4_extract_lane::<2>(acc) + i32x4_extract_lane::<3>(acc)
    }
    #[cfg(not(target_feature = "simd128"))]
    a.iter().zip(b).map(|(x, y)| i32::from(*x) * i32::from(*y)).sum()
}

fn widen(bytes: &[u8], out: &mut [i16]) {
    for (value, byte) in out.iter_mut().zip(bytes) {
        *value = i16::from(*byte as i8);
    }
}

/// Sorted top-k: descending score, earlier (smaller) ids first on ties.
struct TopK {
    scores: [i32; 100],
    ids: [u32; 100],
    filled: usize,
}

impl TopK {
    fn offer(&mut self, score: i32, id: u32, k: usize) {
        if self.filled == k && score <= self.scores[k - 1] {
            return;
        }
        let mut position = if self.filled < k { self.filled += 1; self.filled - 1 } else { k - 1 };
        while position > 0 && self.scores[position - 1] < score {
            self.scores[position] = self.scores[position - 1];
            self.ids[position] = self.ids[position - 1];
            position -= 1;
        }
        self.scores[position] = score;
        self.ids[position] = id;
    }
}

/// Returns q*k result records for pre-validated input.
pub fn search(input: &[u8], n: usize, d: usize, q: usize, k: usize) -> Vec<u8> {
    let mut best: Vec<TopK> = (0..q).map(|_| TopK { scores: [0; 100], ids: [0; 100], filled: 0 }).collect();
    SEARCH_SCRATCH.with_borrow_mut(|(queries, candidate)| {
        queries.resize(q * d, 0);
        candidate.resize(d, 0);
        widen(&input[n * d..], queries);
        // One pass over the candidates; each is widened once and scored against every query.
        for (id, row) in input[..n * d].chunks_exact(d).enumerate() {
            widen(row, candidate);
            for (query, top) in queries.chunks_exact(d).zip(best.iter_mut()) {
                top.offer(dot(candidate, query), id as u32, k);
            }
        }
    });
    let mut output = Vec::with_capacity(q * k * 8);
    for top in &best {
        for rank in 0..k {
            output.extend_from_slice(&top.ids[rank].to_le_bytes());
            output.extend_from_slice(&top.scores[rank].to_le_bytes());
        }
    }
    output
}
