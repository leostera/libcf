# Native C++23 stream lifecycle probe

```sh
bazel test //:stream_lifecycle_local_test
```

Test-only emitted bundle; no deployment configuration, account bindings or live
operations. The explicit `cxx_standard = 23` target has a compile-time assertion
and reports `__cplusplus` at runtime. It is not inferred from a global Bazel flag.

A source with an owned shared capture emits at most128×65536 bytes per stream.
Same-request inspection verifies chunk ownership and explicit cancellation. Owned
loopback HTTP verifies byte order, EOF destruction, pause/resume observations and
client cancellation with the `enable_request_signal` compatibility flag. The
Miniflare direct socket is bound to127.0.0.1, bypassing development proxy behavior.

Native prefetch timing differs from Node's same-isolate test. Paused producer
counts are logged, not asserted as a universal buffer size. If a finite source
already reached EOF before client cancellation, destruction is not attributed to
cancellation. Source release is observed under a2s local budget, not promised as
production disposer timing or proof that all upstream work stopped.

The test runs at most one source concurrently per runtime, checks every received
byte, and disposes the entire owned runtime/temp directory in a finally block.
Synthetic global counters contain no request data and are test instrumentation,
not an application state pattern. See [request lifetime rules](../../docs/request-lifetime.md).
