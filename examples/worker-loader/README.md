# Dynamic Workers

```sh
bazel build //:worker-loader
bazel test //:worker-loader_local_test
```

`cf::WorkerLoader(runtime, binding).fetch(source, request)` loads one JavaScript ES module and returns a buffered response. Source is 1–65536 UTF-8 bytes; requests have a 1 MiB total wire cap and replies a 1 MiB body/64 KiB header cap.

Children use compatibility date 2026-10-13, no flags, `env: {}`, and `globalOutbound: null`. Requested limits are 50 CPU ms and zero subrequests; CPU limits are not wall-clock deadlines. The complete source/config hash determines identity. The fixture selects fixed scripts and does not expose arbitrary-code execution.

Local tests exercise egress denial and absent inherited bindings, not production billing/CPU enforcement. Live creation has separate usage costs. Multiple modules, child Wasm/Python, caller bindings, configurable limits, RPC, streaming, and upgrades are not exposed.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
