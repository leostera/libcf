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

Bazel builds the fixtures before the runner starts. Each round starts all local Workers side by side and interleaves their samples in rotating order. The runner verifies every response and writes to the supplied new absolute report path (existing files are never overwritten). Compilation time is excluded and reported as `null` (schema 4). No Cloudflare credentials or network deployments are involved. The default suite separately verifies matching successful responses without timing thresholds.

Both fixtures expose hello, binary echo and one/16 SHA-256 operations with the same request data, body bound, response bytes and content type. C++ uses the normal libcf coroutine/operation bridge. JS uses native Web Crypto directly and the same bounded body reader. All buffering, copies, allocations and client HTTP work remain in the latency measurements.

Default: six rounds, 10 warmups and 80 measured sequential requests per scenario/variant/round. Each round starts fresh local runtimes; startup includes bundling and the harness's first response. This is not an edge cold-start measurement. Inputs must remain unchanged throughout the run or the runner refuses to emit mixed measurements.

## Rust comparator (workers-rs)

`bench/rust/` is the same fixture written against upstream [workers-rs](https://github.com/cloudflare/workers-rs) (`worker` 0.8.7). Bazel builds it hermetically, mirroring `worker-build --release`: rustc 1.98.0 with Cargo's default release profile (as in the workers-rs templates), wasm-bindgen 0.2.129 `--target module` with the reset-state and abort-handler options, and wasm-opt (binaryen 132) `-O` with worker-build's feature set. `bench/rust-worker.mjs` is worker-build's entry shim. Unlike worker-build, it is not pre-minified; every variant is bundled by the same harness. The default suite checks that all three variants return identical responses.

```sh
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json      # JS, C++ and Rust, interleaved
bazel run //:benchmark_boundary_probe                         # JS<->Wasm calls per request (diagnostic)
```

## Measured results

These are two consecutive full default runs (6 rounds × 80 samples per variant and scenario) from a clean worktree, on 2026-10-21 UTC on an Apple M4 Pro under heavy background load (load average about 10). All three variants run side by side, and each sample index requests every variant once in rotating order, so load drift falls on all variants alike.

| Scenario | JS (ms) | C++ libcf (ms) | Rust workers-rs (ms) | C++ vs Rust |
| --- | ---: | ---: | ---: | ---: |
| Hello | 1.358 | 1.569 | 1.596 | 0.98× |
| Echo, 1 KiB | 1.575 | 1.719 | 1.740 | 0.99× |
| Echo, 64 KiB | 2.830 | 2.580 | 2.536 | 1.02× |
| Echo, 1 MiB | 26.694 | 19.486 | 18.626 | 1.05× |
| SHA-256, 1 × 1 KiB | 1.732 | 1.895 | 1.915 | 0.99× |
| SHA-256, 16 × 1 KiB | 1.783 | 2.018 | 2.171 | 0.93× |
| SHA-256, 1 × 64 KiB | 2.038 | 1.808 | 1.731 | 1.04× |

Times are medians over all samples from both runs (960 requests per variant and scenario). The multiplier is C++ time divided by Rust time; below 1× means libcf is faster. libcf and workers-rs are at parity: per-round paired ratios (in each generated report) span 1× in almost every scenario, and run-to-run differences are as large as the gaps. libcf is consistently ahead only for sequential binding calls (16 digests, about 7% faster). It is not reliably faster than Rust for single requests.

| Code shape | C++ (libcf) | Rust (workers-rs) |
| --- | ---: | ---: |
| Wasm, bytes (gzip) | 50,827 (20,056) | 169,690 (51,649) |
| Bundled JS, bytes (gzip) | 164,311 (29,996), whole libcf runtime | 40,889 (6,966) |
| Deployed total, gzip (per module) | 50,052 | 58,615 |
| Wasm imports / exports | 13 / 20 | 69 / 53 |
| Boundary calls, hello (imports + exports) | 1 + 4 | 28 + 10 |
| Boundary calls, one digest | 2 + 5 | 42 + 14 |
| Boundary calls, 16 digests | 17 + 20 | 252 + 74 |

A request crosses the boundary as: two buffer requests, one call carrying method, URL, headers and body, and one result call that carries status, all response headers and the body. workers-rs calls a binding per JS object access. libcf's Wasm is about a third the size, but its runtime bundles adapters for every supported binding.

Copies per request: libcf reads a Content-Length body natively and copies it once, straight into the `std::string` that becomes `cf::Request::body`. It passes the response body to `Response` as a view of Wasm memory (one copy, inside the constructor). workers-rs copies `arrayBuffer()` into a `Vec` and copies again into the `Response`.

Digests: `SubtleCrypto::sha256/384/512` borrow a `std::span<const std::uint8_t>` (use `cf::bytes_of(request.body)` for text) and return an allocation-free awaitable. A dedicated host import passes Wasm memory directly to Web Crypto, and the 32–64 byte result is written to a static buffer. Unlike the general binding path, no `std::function`, shared state or reply allocation is involved. Binding replies on the general path are written in place into the pending operation instead of through a temporary `malloc`.

See [methodology and limitations](../docs/benchmarks.md). Each locally generated report includes raw samples, toolchain/host details, and source and artifact hashes. Generated reports are not committed. The incremental digest estimate is not a direct measurement of individual ABI instructions, and no throughput, memory or statistical-significance claim is made.
