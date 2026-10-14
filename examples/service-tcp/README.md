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

**Live verification is pending.** No live deployment helper is enabled yet. Both
configs disable workers.dev/previews and have no public routes. Do not deploy the
static fixture names over existing resources. See [networking scope](../../docs/networking-readiness.md)
for managed-platform versus standalone experimental capabilities.
