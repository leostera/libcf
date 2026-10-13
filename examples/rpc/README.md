# JSON-only service RPC from C++

```sh
npm ci
node scripts/build-worker.mjs examples/rpc/wrangler.jsonc
node --test examples/rpc/test/*.test.mjs
```

The fixture starts its JS reference service locally; no account or credentials are used. Included in the default suite.

`cf::RpcService(context.bindings, "REFERENCE").call_json(method, arguments_json = "[]")` returns `AsyncResult<std::string>` containing serialized JSON. It calls a method on a configured service binding, not an account REST API. The example reference is a default `WorkerEntrypoint` class.

- Method names: 1–100 ASCII letters/digits/underscores, starting with a letter. The JS boundary rejects inherited-object names and `prototype`, `dup`, `then`, `fetch`, `connect`, `alarm` and WebSocket event-handler names. This is intentionally narrower than every platform RPC surface.
- Arguments must be an owned JSON array of 0–32 values. Input/output limits: 1 MiB, depth 32, 65,536 value nodes. JSON number precision and duplicate-key parsing follow JS semantics; use strings for exact large integers. C++ prechecks method shape and byte bounds; JSON parsing/reserved-name checks happen before provider invocation in JS.
- Results support finite numbers, strings, booleans, null, dense arrays and ordinary/null-prototype records. Capabilities, functions, streams, custom prototypes, accessors, sparse arrays, non-enumerable data, cycles and unsupported primitives reject. JSON output is not canonical. The C++ result is JSON text, not a bundled C++ JSON DOM.
- Both the pending RPC promise and resolved object are disposed explicitly. Cancellation does not prove the remote call stopped: a local native probe observed a disposed promise still fulfilling. Late results are drained and disposed, not delivered to a cancelled C++ caller. Encoding failure also disposes returned objects. Remote side effects are not rolled back; server disposer timing and physical resource reclamation are not guaranteed.

Two C++/workerd cases verify scalar/nested JSON, concurrent calls, provider failure, unsupported capability/oversized output, invalid arguments/reserved methods/missing binding and recovery. Separate JS-only real workerd tests verify native capability invalidation after rejected or late results; adapter tests cover ownership, cleanup traps and cancellation. Native tests cover the C++ request/reply bounds and operation wiring. **Live verification is pending.**

Routes are diagnostic only: `/sum`, `POST /echo` (body is the argument array), `/failure`, `/capability`, `/large`, `/reserved`, `/missing`. They have no production authorization and must not expose arbitrary RPC management publicly.

Not implemented: C++ RPC exports/server methods, arbitrary JS interop, getters, capability forwarding, functions/streams, generated stubs or retry/exactly-once semantics. Reflection assumes ordinary native by-value results, not adversarial in-process Proxies or modified JS intrinsics. See [wire boundaries](../../docs/wire-boundaries.md).

Sources accessed 2026-10-13: [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/) (updated 2026-10-08), [reserved methods](https://developers.cloudflare.com/workers/runtime-apis/rpc/reserved-methods/) (updated 2026-10-13). Compatibility is pinned to 2026-10-13.
