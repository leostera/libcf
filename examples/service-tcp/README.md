# Bounded Worker service TCP

```sh
bazel build //:service-tcp
bazel test //:service-tcp_local_test
```

`cf::ServiceTcp::exchange(ServiceTcpRequest)` calls a configured Worker service binding's `connect()`. It writes an owned buffer, half-closes the writer, and reads until EOF. Reading and writing run concurrently. The virtual hostname/port is delivered to the bound Worker, not resolved externally.

Hostnames are 1–253 ASCII alphanumeric/dot/hyphen characters with alphanumeric endpoints; ports are 1–65535. Input and response caps are 1 MiB; timeout is 1–60000 ms. Empty input/output is valid. Peers must support the half-close/EOF protocol. Cleanup is best effort; failure does not establish that no bytes arrived, and calls are not retried.

Local tests use a real private Worker connection. This is not global TCP, persistent sockets, a database driver, UDP, TLS/StartTLS, or a C++ inbound connect handler.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
