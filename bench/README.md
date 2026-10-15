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

See [methodology and limitations](../docs/benchmarks.md). Raw samples, toolchain/host details, source and artifact hashes are included in the report. The incremental digest estimate is not a direct measurement of individual ABI instructions, and no throughput, memory or statistical-significance claim is made.
