# C++ vs JavaScript benchmarks

**Just write JavaScript unless you have a good reason to use C++.**

Use libcf when you need existing C++ code, libraries, or expertise—not because
putting a Worker in Wasm automatically makes it faster. These scenarios exercise
HTTP, copying, and platform crypto rather than a compute-heavy C++ advantage.
Measure your own workload before choosing C++ for performance.

## Run locally

```sh
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json
# Short diagnostic run:
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark-smoke.json --rounds 2 --samples 5 --warmups 0
```

Bazel builds the C++ fixture before the runner starts. The runner starts and disposes both local Workers in alternating order, verifies every response, and writes to the supplied new absolute report path (existing files are never overwritten). Compilation time is excluded and reported as `null` in schema 2. No Cloudflare credentials or network deployments are involved. The default suite separately verifies matching successful responses without timing thresholds.

Both fixtures expose hello, binary echo and one/16 SHA-256 operations with the same request data, body bound, response bytes and content type. C++ uses the normal libcf coroutine/operation bridge. JS uses native Web Crypto directly and the same bounded body reader. All buffering, copies, allocations and client HTTP work remain in the latency measurements.

Default: six rounds, 10 warmups and 80 measured sequential requests per scenario/variant/round. Each round starts a fresh local runtime; startup includes bundling and the harness's first response. This is not an edge cold-start measurement. Inputs must remain unchanged throughout the run or the runner refuses to emit mixed measurements.

## Measured results

A full local run on **2026-10-21 UTC**, from clean source revision `7a4a59b`, on an Apple M4 Pro (macOS 25.6.0; Node 26.11.1; Emscripten 6.0.12) produced these results. Each median below summarizes 480 requests per variant and scenario (six rounds × 80 samples); the paired delta is the median of the six per-round C++ minus JS median differences. Positive deltas mean C++ was slower.

| Scenario | JS median (ms) | C++ median (ms) | Paired median Δ (ms) |
| --- | ---: | ---: | ---: |
| Hello | 1.814 | 2.789 | +0.960 |
| Echo, 1 KiB | 2.495 | 3.600 | +0.678 |
| Echo, 64 KiB | 4.736 | 5.668 | +0.349 |
| Echo, 1 MiB | 42.293 | 45.055 | +6.811 |
| SHA-256, 1 × 1 KiB | 2.362 | 3.143 | +0.535 |
| SHA-256, 16 × 1 KiB | 2.901 | 4.294 | +1.719 |
| SHA-256, 1 × 64 KiB | 4.251 | 4.509 | −0.253 |

The measured ESM + Wasm modules totaled **2,631 bytes (1,088 gzip bytes)** for JS and **215,706 bytes (49,765 gzip bytes)** for C++; gzip is summed per module. These are local sequential HTTP measurements, not production edge latency. This run favors the matched JavaScript baseline in most scenarios and does not establish a general performance ranking; use the methodology and limitations below when interpreting it. The full raw report is generated locally and intentionally not committed.

See [methodology and limitations](../docs/benchmarks.md). Raw samples, toolchain/host details, source and artifact hashes are included in each locally generated report. The incremental digest estimate is not a direct measurement of individual ABI instructions, and no throughput, memory or statistical-significance claim is made.
