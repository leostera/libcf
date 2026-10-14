# Buffered dynamic dispatch

`cf::DispatchNamespace::fetch(DispatchTarget, Request)` resolves a user Worker by
name for one buffered HTTP call. The application must authorize that selection
and remove platform-only credentials before forwarding. Names in this subset are
1–63 ASCII alphanumeric/underscore/hyphen characters, starting alphanumeric.

```cpp
cf::DispatchNamespace dispatcher(context.bindings, "DISPATCHER");
cf::DispatchTarget target{"example"};
target.limits.cpu_time = std::chrono::milliseconds(50);
target.limits.sub_requests = 0;
auto response = co_await dispatcher.fetch(std::move(target), std::move(request));
```

The adapter calls `get(name, {}, { limits: { cpuMs, subRequests } })` and invokes
that Fetcher once, preserving receivers. SDK policy accepts1–30000ms CPU and
0–1000 subrequests, default50ms/0. These are subset caps, not a claim about every
plan's limits. CPU time is **not** a wall-clock deadline. Redirects are manual;
HTTP error statuses are returned normally. Lookup/fetch errors are failures.

Requests have a **1MiB total wire** budget, including method, headers and field
prefixes; the usable body is smaller. Headers are capped at64KiB and response
bodies at1MiB. Cancellation uses the request lifetime, caps response reads and
best-effort cancels late/rejected bodies without waiting on stalled cleanup. It
does not guarantee peer rollback, stopped CPU/billing, or immediate settlement
from a provider that ignores abort. No retry is performed. Upgrades are rejected.

```sh
bazel build //:dispatch_bundle //:dispatch-reference_bundle
bazel test //:native_dispatch_test //:js_dispatch-adapter_test //:dispatch_local_test
```

The local harness uses `test/local.wrangler.jsonc`: an **explicit mock namespace**
returns a real local service Fetcher to the private JS reference. This proves
C++/Wasm dispatch, binary/header/status forwarding, ownership, concurrency, limits
and error/recovery wiring, but **not native WfP namespace routing, CPU/subrequest
enforcement or tenant isolation**. Classification is M, not provider L/V.

The production config has a placeholder namespace, no routes, and workers.dev /
preview URLs disabled. It is rejected by default local tests. No dispatch
namespace was created and no subscription was enabled. Live work requires WfP
entitlement/budget confirmation and an isolated resource/cleanup plan; do not deploy
these fixed example names over existing resources.

Props (including JSON), RPC capabilities, outbound parameter overrides, retained
Fetcher handles, streaming and namespace administration are not implemented.
The example only selects fixed targets; it is not a tenant authentication layer.
See [the readiness audit](../../docs/dispatch-readiness.md) for provider contracts,
isolation differences, published fees and remaining verification.
