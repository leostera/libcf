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

## Rust comparator (workers-rs)

`bench/rust/` is the same fixture written against upstream [workers-rs](https://github.com/cloudflare/workers-rs) (`worker` 0.8.7). Bazel builds it hermetically, mirroring `worker-build --release`: rustc 1.98.0 with Cargo's default release profile (as in the workers-rs templates), wasm-bindgen 0.2.129 `--target module` with the reset-state and abort-handler options, and wasm-opt (binaryen 132) `-O` with worker-build's feature set. `bench/rust-worker.mjs` is worker-build's entry shim. Unlike worker-build, it is not pre-minified; every variant is bundled by the same harness. The default suite checks that all three variants return identical responses.

```sh
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json      # JS, C++ and Rust, rotating order
bazel run //:benchmark_boundary_probe                         # JS<->Wasm calls per request (diagnostic)
```

## Measured results

These are two consecutive full default runs (6 rounds × 80 samples per variant and scenario) from a clean worktree, on 2026-10-21 UTC on an Apple M4 Pro under moderate background load. Values are medians in milliseconds. The C++/Rust ratio is the median of per-round paired ratios.

| Scenario | JS | C++ (libcf) | Rust (workers-rs) | C++/Rust, run 1 | C++/Rust, run 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hello | 1.194 | 1.508 | 1.473 | 1.06 | 1.03 |
| Echo, 1 KiB | 1.462 | 1.464 | 1.619 | 1.01 | 1.11 |
| Echo, 64 KiB | 3.270 | 2.573 | 2.423 | 1.10 | 1.04 |
| Echo, 1 MiB | 26.051 | 16.315 | 16.447 | 1.10 | 1.05 |
| SHA-256, 1 × 1 KiB | 1.534 | 1.741 | 1.416 | 1.41 | 1.27 |
| SHA-256, 16 × 1 KiB | 1.507 | 2.075 | 1.949 | 1.10 | 1.10 |
| SHA-256, 1 × 64 KiB | 1.545 | 1.858 | 1.570 | 1.01 | 1.25 |

Absolute medians are from run 1. Run-to-run differences are of the same order as several of the gaps, so treat single-digit percentages as noise.

| Code shape | C++ (libcf) | Rust (workers-rs) |
| --- | ---: | ---: |
| Wasm, bytes (gzip) | 54,729 (20,456) | 169,690 (51,254) |
| Bundled JS, bytes (gzip) | ~161 KB (~29 KB), whole libcf runtime | 40,889 (6,966) |
| Deployed total, gzip (per module) | 50,123 | 58,615 |
| Wasm imports / exports | 13 / 15 | 69 / 53 |
| Boundary calls, hello (imports + exports) | 2 + 10 | 28 + 10 |
| Boundary calls, one digest | 3 + 13 | 42 + 14 |
| Boundary calls, 16 digests | 18 + 58 | 252 + 74 |

libcf moves each request across the boundary in one packed call with one result call. workers-rs calls a binding per JS object access. libcf's Wasm is about a third the size, but its runtime bundles adapters for every supported binding.

Copies per request: libcf reads a Content-Length body natively and copies it once into Wasm memory, and passes the response body to `Response` as a view of Wasm memory (one copy, inside the constructor). workers-rs copies `arrayBuffer()` into a `Vec` and copies again into the `Response`. For digests, libcf now passes Wasm memory directly to Web Crypto. However, the public `SubtleCrypto::sha256(Bytes)` takes its input by value, so the fixture copies the input once per call. Rust borrows a slice.

Remaining gap: small SHA-256 requests stay 10–40% slower than Rust (about 0.2–0.5 ms). Each libcf binding call is scheduled as a host operation: a microtask, a promise chain, a reply copy allocated with `malloc`, and coroutine resumption. workers-rs awaits the JS promise directly. Removing this cost needs a borrowed-input digest API or a lighter operation-completion path, so it is left as a follow-up.

See [methodology and limitations](../docs/benchmarks.md). Each locally generated report includes raw samples, toolchain/host details, and source and artifact hashes. Generated reports are not committed. The incremental digest estimate is not a direct measurement of individual ABI instructions, and no throughput, memory or statistical-significance claim is made.
