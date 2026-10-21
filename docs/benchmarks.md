# Local benchmarks

**Just write JavaScript unless you have a good reason to use C++.** Reusing C++ code
can be valuable, but Wasm alone is not a performance advantage. Fixtures and the
runner live in [`bench/`](../bench/README.md).

Compare the SDK Worker with a matched plain-JavaScript baseline and an upstream workers-rs (Rust) build of the same fixture:

```sh
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json
```

Choose a new absolute path; the runner refuses to overwrite reports. It builds the fixture before measurement, uses only local requests, validates responses, and disposes its runtimes. Do not commit generated reports.

Each of six rounds starts all variants side by side, then interleaves ten warmups and eighty sequential measured requests per scenario: every sample index requests each variant once, in rotating order, so slow host load drift affects all variants alike. Scenarios cover hello, binary echo at several sizes, and one versus repeated SHA-256 operations. Reports include samples, artifact sizes/hashes, tool versions, and source fingerprints. They also include paired per-round deltas and ratios for C++/JS, C++/Rust, and Rust/JS. `bazel run //:benchmark_boundary_probe` counts JS↔Wasm calls per request for C++ and Rust by wrapping instance imports and exports; its wrappers add overhead, so it is never used for timing.

The Rust variant mirrors `worker-build --release` (see the [benchmark README](../bench/README.md#rust-comparator-workers-rs)) except for its final minification. All variants pass through the same esbuild bundling, so bundle sizes are comparable but are not byte-identical to a `worker-build` deployment.

Compilation is excluded. Setup includes bundling, local runtime startup, and first-response initialization; it is not an isolated edge cold start. HTTP latency includes loopback transport, copying, allocation, and scheduling—not just the JS/Wasm boundary. Repeated-hash subtraction is a noisy estimate, not a precise ABI cost.

Repeat runs on a quiet machine and retain outliers when comparing changes. These measurements do not establish production latency, throughput, memory usage, or statistical significance. CI checks benchmark correctness, not performance thresholds.

The older minimal bridge comparator is available through `bazel run //:benchmark_spike`; its variants do not implement matching functionality. Prefer the [SDK fixture](../bench/README.md) for application comparisons.
