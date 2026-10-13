# Local C++ versus plain-JS baseline

## Reproduce

```sh
npm ci
node scripts/bench-sdk.mjs
```

See [`examples/benchmark`](../examples/benchmark/README.md). The runner builds the fixture and writes `build/benchmark/report.json`. It makes only local requests, validates every response, disposes every runtime in `finally`, and rejects changed source inputs. No performance threshold is imposed on CI.

[Recorded raw data](benchmarks/local-2026-10-13.json) includes 6,720 measured request samples, per-round statistics, module hashes, source fingerprint and tool versions. It was recorded on 2026-10-13 at 15:29 UTC on an Apple M1 Max, arm64, Darwin 25.6.0, 10 logical CPUs. Node 26.11.1; Emscripten 6.0.12-git (`-O2`); esbuild 0.28.2; Miniflare 5.20261006.1-alpha; workerd 1.20261006.1; compatibility date 2026-10-13.

The worktree included concurrent formatter changes and the new benchmark, so the recorded Git base alone is not an exact source identity. The runner hashed 64 relevant input files before and after measurement: `2ad8f72f668c55c1df80a17cb15221e9915356b8a90896253f6426431ae9b77c`. Artifact hashes are also recorded. No background-load or thermal isolation is claimed.

## Method

- Six rounds; alternate JS→C++ and C++→JS runtime order. Each variant starts a fresh local workerd runtime per round.
- Seven scenarios; 10 warmups followed by 80 sequential measured requests per scenario, per variant, per round (480 measured samples per table cell).
- Both implementations use the same body cap and successful response bytes, status and content type. Binary payloads contain varied bytes, including NUL and non-UTF-8 values.
- Timing starts before client `fetch` and ends after consuming the response. Correctness assertions run outside the timer. Client/server HTTP, buffering, allocation and scheduling are included.
- Quantiles use linear interpolation. Paired deltas are computed from each round's C++ and JS medians, then summarized; they need not equal the difference between pooled medians.

## Latency (milliseconds)

| Scenario | JS median | C++ median | JS p95 | C++ p95 | Median paired delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hello | 0.562 | 0.611 | 1.000 | 1.178 | +0.038 |
| Echo 1 KiB | 0.693 | 0.741 | 1.018 | 1.189 | +0.062 |
| Echo 64 KiB | 1.197 | 1.261 | 2.113 | 2.325 | +0.054 |
| Echo 1 MiB | 7.489 | 7.576 | 11.607 | 11.952 | +0.087 |
| SHA-256 once, 1 KiB | 0.689 | 0.746 | 1.019 | 1.213 | +0.057 |
| SHA-256 16 times, 1 KiB | 0.725 | 0.837 | 1.171 | 1.462 | +0.116 |
| SHA-256 once, 64 KiB | 0.916 | 0.984 | 1.459 | 1.632 | +0.069 |

### Incremental digest bridge estimate

For each round, compute `((C++16 − C++1) − (JS16 − JS1)) / 15` using the 1-KiB digest scenario medians. Median estimate: **4.44 μs per additional digest call**, with a per-round range of **−0.11 to 8.10 μs**. Negative estimates are retained rather than clamped: this comparison is noise-sensitive.

This estimates the incremental cost of the C++ adapter, owned copies, allocations and coroutine/promise scheduling relative to native JS. It is **not** an isolated ABI instruction cost, a confidence interval, proof of statistical significance or a production performance guarantee.

## Setup and bundle size

| Measure | Plain JS | C++/Wasm |
| --- | ---: | ---: |
| Median bundle + local runtime + first-response readiness | 71.37 ms | 78.49 ms |
| Total ESM + Wasm bytes | 1,523 | 103,864 |
| Sum of per-module gzip bytes, level 9 | 729 | 31,747 |

C++ artifacts: 49,522-byte bundled ESM and 54,342-byte Wasm. The ESM includes the generic SDK runtime and its currently supported adapters, not only the digest adapter. Gzip totals exclude upload/config framing and are not claimed to match `cf deploy`'s reporting formula.

Setup includes esbuild, local process/runtime work, the harness's readiness request and initial Wasm instantiation. Compiler build time is recorded separately. OS/file/compiler caches may be warm; this is **not production cold-start evidence**.

## Remaining release measurements

Production edge latency/cold starts, CPU/memory profiles, concurrent throughput, additional binding workloads and a pure ABI microbenchmark remain unmeasured. The earlier spike benchmark remains a rough feasibility probe, not an interchangeable baseline. Current local comparisons must not be used to claim complete platform parity or universal C++ performance advantages.
