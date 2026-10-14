# libcf: platform inventory and build backlog

Status: research-backed scope inventory, **not a parity claim**. libcf now has a Bazel-built C++ library, examples, native/JS/local tests and qualified live evidence. See the [coverage matrix](docs/coverage.md) and [operation ledger](docs/binding-operations.md) for implemented subsets, gaps and verification provenance. Research baseline: 2026-10-13; implementation-status framing updated 2026-10-14. Baseline: cloudflare/workers-rs commit `b171cb4bdd6fa943bb81f429df0a6b0df37e14b3` (`worker` 0.8.7), plus `../rescript-cloudflare`'s example and local-emulator inventories. Sources and caveats: [research note](../ai-research/personal/libcf/cpp-workers-platform-inventory/README.md) (the research repository is a separate sibling under `~/Developer/github.com/leostera/`).

## Scope and validated architecture

The implemented target is **Workers module format**: a small JavaScript/TypeScript entry module receives platform events/bindings and passes them to an Emscripten-compiled C++20/23 Wasm module. The JS layer should only adapt JS objects, promises, streams, and lifecycle to a carefully owned C++ API; no Cloudflare REST API when a binding exists. A general escape hatch for as-yet-unwrapped JS values remains an open design requirement. Never assume a JS binding can be called directly from Wasm or that the Rust-specific `worker-build --emscripten` / wasm-bindgen flow builds C++: **that announcement is Rust tooling, not a C++ SDK**. C++ compilation, module initialization, owned async request/response and binding access are verified through the selected minimal C ABI + JS glue; see [lifetime rules](docs/request-lifetime.md), [wire boundaries](docs/wire-boundaries.md) and [benchmarks](docs/benchmarks.md). The matched benchmarks do not isolate allocation counts or ABI-only overhead. Bazel 9.3.0 is the sole supported build/test/package system, with pinned Emscripten, Node, Miniflare/workerd and compatibility settings; see [Bazel setup](docs/bazel.md). Generated binding-type checks and remaining standard-library/thread/socket/filesystem constraints still require explicit coverage. Cloudflare operations use the cf CLI, not Wrangler subprocesses. Live tests remain opt-in on isolated approved identities; package publication requires confirmation.

Classification below: **R** = exposed by the inspected workers-rs high-level `worker` crate; **P** = platform/peer binding candidate not covered by that Rust surface (verify per current docs); **X** = special deployment or experimental status, not automatic Worker parity. An inventory row is a task, not evidence of runtime support or a passing test. Each row should get a public API, one `examples/<name>/` sample, and an integration test unless marked differently.

## 0. Foundation requirements and remaining audit work

- [x] F01: C++ hello-world Wasm loads in a module Worker; Bazel local tests and declared deployment artifacts pass. Toolchain versions, repeated bundle hashes and matched size/startup measurements are recorded in [Bazel evidence](docs/bazel.md) and [benchmarks](docs/benchmarks.md). Native host-toolchain limitations remain documented.
- [ ] F02: Implement explicit JS⇄Wasm ownership contract: handles, UTF-8, byte buffers, null/undefined, JS errors, exceptions, 64-bit numbers, serialization and cancellation; leak/use-after-free/reentrancy tests.
- [ ] F03: Establish async bridge (Promise to C++ continuation/coroutine or callbacks) without blocking the isolate; guarantee request and `waitUntil` lifetimes, response streaming and backpressure. Test rejection, cancellation and large bodies.
- [ ] F04: Build ergonomic `cf::Request`, `Response`, `Headers`, `Env`, `Context`, `Result`, body streams, and handler registration; native C++ unit tests plus runtime tests.
- [ ] F05: Generate/check binding declarations against pinned Workers TS types + Wrangler schema; maintain feature support ledger `implemented / compiled / local-tested / remote-tested / unavailable` at operation granularity; never equate compilation with parity.
- [ ] F06: Bazel 9.3.0/Bzlmod build/test/package cutover, pinned JS/Wasm tooling, templates and native/local/sanitizer/package CI are verified. Complete generated adapter type checks, formatting integration and explicit bundle/latency budgets before closing this broader requirement. Do not restore CMake compatibility; see [cutover evidence](docs/bazel-migration.md).

## 1. Rust/Wasm API baseline (inspected `worker/src`, `worker-sys`, and examples)

| Track | Rust baseline / binding operations to inventory | Example(s) and minimum tests |
|---|---|---|
| Events & runtime **R** | fetch, scheduled, queue (feature-gated), email receive, DO fetch/alarm/WebSocket handlers; startup, logs, `waitUntil`, version metadata | `hello`, `scheduled`, `queue-consumer`, `email-inbound`, `do-counter`; dispatch and error/lifetime tests |
| HTTP & web **R** | request/response, headers, URL, query, cookies/CF request metadata, form-data, redirects, CORS, Fetch, service fetcher, Cache API, streams, abort/signal, WebSocket pair/client | `router`, `streaming-proxy`, `multipart-upload`, `websocket-echo`, `cache-aside`; large streaming/backpressure/abort tests |
| Env & identities **R** | typed vars, JSON vars, secrets, binding lookup, service/assets fetcher, worker version; CF geo/bot/TLS metadata | `env-and-metadata`, `assets`, `service-binding`; missing-binding/type/error tests |
| Storage **R** | KV get/put/delete/list with metadata/options; D1 prepare/bind/first/all/run/batch/raw; R2 head/get/put/delete/list, metadata, range, multipart; Cache match/put/delete | `kv-crud`, `d1-sql`, `r2-upload`, `r2-multipart`, `cache-aside`; binary, pagination, SQL binding, ranges |
| Durable Objects **R** | namespace IDs/stubs, fetch/connect, persistent storage CRUD/list/transactions, SQL storage, alarms, concurrency gate, hibernating WebSockets/tags | `do-counter`, `do-sql`, `do-chat`, `do-alarm`; restart, transaction rollback, wakeup, concurrent updates |
| Jobs & coordination **R** | queue producer/consumer ack/retry; scheduled dispatch, DO alarms; rate-limiter binding | `queue-producer`, `queue-consumer`, `scheduled`, `rate-limit`; retry/duplicate/failure paths |
| AI & analytics **R** | Workers AI run/bytes; Analytics Engine write data point; log/trace integration | `ai-inference`, `analytics-write`; local mock contract + authorized remote test for actual AI |
| Network & services **R** | TCP/UDP sockets, Hyperdrive binding, dynamic dispatch namespace, Containers via DO, Secrets Store, Email Sending | `tcp-client`, `udp-client`, `hyperdrive`, `dispatch`, `container`, `secrets-store`, `email-send`; test by environment capability |
| Developer ergonomics **R** | router, error/result conversion, crypto/digest, date/delay, optional HTTP adapters; experimental Workers RPC | `router`, `crypto`, `rpc-client`, `rpc-server`; native unit tests and JS interop tests |

[Networking audit](docs/networking-readiness.md): a [bounded C++ service TCP client](examples/service-tcp/README.md) now has local verification against a JS connect handler; general sockets and C++ inbound handling remain open. Direct public TCP ingress is not supported by current docs; `node:dgram` is a non-functional stub, while standalone workerd's experimental UDP is a separate, unverified track. Hyperdrive needs a database driver and an authorized database; local direct connections do not verify managed pooling/cache behavior.

Rust feature availability varies: `queue` and `d1` are feature-gated; RPC is explicitly experimental/partial. `worker-build --emscripten` and Rust's Tokio support are *not* evidence that Emscripten C++ socket/async integration works in our wrapper.

## 2. Platform expansion beyond the inspected Rust high-level API

Use `../rescript-cloudflare/packages/cloudflare/src/` and its `docs/local-emulator-inventory.md` as candidate/example inspiration, **not proof of production parity**. Prioritize after a working core; consult the current runtime docs and installed types for each API before implementing.

| Track | Candidate binding/surface and example | Validation classification |
|---|---|---|
| **P** Workflow binding and handler | `workflow-order`: create/status, steps/retries/wait/events | ReScript peer has a local subset; test persistence/retries separately |
| **P** Pipelines | `pipeline-ingest`: producer send | Local accept ≠ durable sink; remote gated |
| **P** Vectorize / AI Search / Agent Memory | `vector-search`, `ai-search`, `agent-memory` | Remote-proxy-only in peer's pinned emulator; no local parity claim |
| **P** Images / Stream / Media | `image-transform`, `image-upload`, `video-upload`, `media-transform` | Images/Stream partial local; transcode/remote service separate |
| **P** Browser rendering | `browser-screenshot` | Local browser smoke possible; hosted browser separate |
| **P** Flags / artifacts | `feature-flag`, `artifact-files` | Flagship local seed is test-only; Artifacts remote-only in peer |
| **P** mTLS / VPC | `mtls-fetch`, `private-service` | Account/network required; peer emulator proxy only |
| **P** Workers Loader / RPC | `load-worker`, `rpc-call` | Dynamic loader local subset; RPC protocol compatibility separate |
| **P** other account bindings | `analytics-sql`, `static-assets`, `version-metadata`, `email-inbound` | Verify actual Worker binding types and runtime before claiming support |
| **X** Containers, inbound TCP to DO, Emscripten FS/sockets | `container-port`, `incoming-tcp`, `filesystem` | Deployment and compatibility constraints; native C++ proof required |
| **X** legacy Workers Sites | `legacy-sites` (optional) | Prefer modern static assets; separate compatibility track |

Platform products exposed only through REST APIs, dashboards, or external JS SDKs are **not** implicitly in scope as Worker bindings. Add them only after documenting their actual in-Worker access model; do not conflate product catalog with runtime API parity.

## 3. Delivery order and exit criteria

1. **Spike (F01–F03):** local hello/async/stream tests; select JS bridge with measured Wasm size, cold init and interop overhead. If this fails, revisit target/toolchain before implementing bindings.
2. **Core (F04–F06):** fetch/headers/body/context/env/fetcher/router/crypto; 8+ independently runnable examples, contract tests, CI.
3. **Storage/services:** KV, D1, R2, Cache, assets, service bindings; local tests for every advertised operation and edge case.
4. **State/events:** DO (including SQL/alarms/WebSockets), Queues, Cron, email; test lifetime, retries, eviction/restart and error semantics.
5. **Wider binding coverage:** all remaining **R**, then **P** tracks with per-capability release gates; mark unsupported/experimental clearly rather than claiming blanket parity.
6. **Release:** versioned package/install guide, one-command example build/test, documented compatibility matrix, reproducible Wasm artifacts, performance measurements against plain JS baseline; optional remote smoke suite requires explicit credentials and opt-in, never part of default local CI.

For each example: own entrypoint/config, README with run/test instructions, no secrets, one positive and one failure-path test where possible. Keep default suite strictly local; remote-only operations require opt-in contract tests/mocks and clear `unverified` labels. Deployment tests are separately opt-in.
