# Bounded service TCP exchange

```sh
bazel build //:service-tcp //:service-tcp_bundle //:service-tcp-reference_bundle
bazel test //:native_service_tcp_test //:js_service-tcp-adapter_test //:service-tcp_local_test
```

`cf::ServiceTcp` in `<cf/service_tcp.hpp>` uses a configured Worker service
binding's native `connect()` method. It writes an owned buffer, half-closes the
write side, and collects bytes until peer EOF. Reads and writes run concurrently
to avoid duplex backpressure deadlock. This is **not** a persistent socket API,
a database driver, global outbound TCP, UDP, TLS/StartTLS or C++ inbound handler.

```cpp
cf::ServiceTcp backend(context.bindings, "BACKEND");
cf::ServiceTcpRequest request{
    .hostname = "echo.invalid", .port = 1234,
    .body = cf::Bytes{0, 128, 255},
    .timeout = std::chrono::milliseconds(5000),
    .response_limit = 1048576,
};
auto result = co_await backend.exchange(std::move(request));
```

The virtual hostname/port is delivered to the bound Worker, not resolved to an
external destination. Hostnames are1–253 ASCII alphanumeric/dot/hyphen characters
with alphanumeric endpoints; ports are1–65535. IPv6 literals and arbitrary URL
strings are not supported by this subset. Inputs are at most1MiB; response limits
are1–1,048,576 bytes. Empty input/output is valid. Timeout is1–60,000 milliseconds
and covers opening, writing and reading, subject to host timer scheduling.

The example's private JS reference exports `connect`, not HTTP echo. Real local
C++/Wasm tests cover empty/binary/1MiB buffers, eight concurrent requests, invalid
address, overflow, deadline and recovery. Native and JS tests cover ownership,
reply validation, pre-abort, late opening, failures and hanging cleanup. No mock
socket substitutes for the local integration's native service connection.

Every exchange closes its socket on success/failure/cancellation. Cleanup is
best-effort and is not awaited indefinitely. There are no automatic retries;
failure or cancellation does not establish that the peer received no bytes or
rolled back its effects. The peer must implement a half-close/EOF protocol; a
persistent interactive peer will eventually hit the deadline instead.

[The isolated Bazel live probe](../../docs/live/bazel-service-tcp-2026-10-14.json)
passed empty/binary/1MiB, concurrency, invalid-address, overflow, deadline and
recovery cases; both Workers and frontend DNS/certificate-pack cleanup were
independently checked. This does not extend support to persistent sockets, socket
TLS or C++ inbound handlers. Build isolated artifacts with
`bazel run //:prepare_live_worker -- service-tcp` (no deployment). The retained
manifest names the private upstream and approved HTTPS frontend. Deploy the
private upstream first using cf CLI, then the frontend; run
`bazel run //:live_service_tcp -- <manifest-hostname>`. Always verify deletion of
both owned Workers plus frontend DNS/certificate cleanup, including on failure.
workers.dev/previews stay disabled. Do not deploy static fixture names over
existing resources. See [networking scope](../../docs/networking-readiness.md)
for managed-platform versus standalone experimental capabilities.
