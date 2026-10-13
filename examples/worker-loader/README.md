# Isolated dynamic Workers from C++

```sh
npm ci
node scripts/build-worker.mjs examples/worker-loader/wrangler.jsonc
node --test examples/worker-loader/test/*.test.mjs
```

Included in the default suite. `cf::WorkerLoader(runtime, binding).fetch(source, request)` loads one JavaScript ES module and returns a bounded HTTP response. The parent is C++/Wasm; this first subset does not load additional JS/Wasm modules into the child.

## Enforced adapter policy

- Source: 1–65,536 UTF-8 bytes. Request/response bodies and headers use the existing Service Binding bounds (1 MiB bodies, 64 KiB headers); responses are buffered, not streamed across this API.
- Child compatibility date: `2026-10-13`, no compatibility flags.
- `env: {}` and `globalOutbound: null`: no inherited bindings and no global HTTP/TCP egress. Forwarded request fields are explicitly visible to child code; do not forward sensitive data unnecessarily.
- Requested resource limits: 50 CPU milliseconds and zero subrequests. These settings are asserted in adapter tests; local tests do not establish live CPU enforcement or a wall-clock execution deadline.
- SHA-256 of the complete source/config determines the loader ID. Changed code or isolation settings cannot accidentally reuse an old cached configuration. The native loader owns caching; no isolate persistence or exactly-once initialization guarantee is made.
- Each operation retains its own source/request. No child stub or result is stored in module-global request state.

The example chooses only fixed fixture scripts; it does **not** publish an arbitrary-code execution endpoint. Three workerd tests cover HTTP forwarding, separate source identities, absent parent bindings, explicit platform denial for both HTTP and TCP, missing bindings, invalid/oversized source, oversized responses and recovery. Denial assertions require the runtime's permission error, not just a generic network/DNS failure. Native and direct JS tests cover source bounds, operation selection, errors, malformed wire rejection before stub creation and complete cache identity.

Not implemented: caller-selected IDs, arbitrary bindings, outbound gateways, configurable limits, multiple modules, child Wasm/Python, named/RPC entrypoints, child DO facets or workflows, streaming and WebSocket upgrades.

## Live status

Not attempted yet. Dynamic Workers require a Workers Paid plan and have a separate creation meter: 1,000 unique Dynamic Workers per month included, then $0.002 per unique Worker per day, plus ordinary Workers request/CPU usage. A bounded fixture probe would use at most seven unique source/config identities (up to $0.014 in creation charges if the allowance is exhausted). Live execution is deferred pending cost approval; no subscription or billing settings were changed and no dynamic Workers were created remotely.

Sources retrieved 2026-10-13: [API](https://developers.cloudflare.com/dynamic-workers/api-reference/), [egress isolation](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/), [limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/), [pricing](https://developers.cloudflare.com/dynamic-workers/pricing/). The former Worker Loader documentation redirects to Dynamic Workers.
