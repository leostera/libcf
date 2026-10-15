# Buffered outbound HTTP

```sh
bazel build //:http-client
bazel test //:http-client_local_test
```

`cf::HttpClient(context.bindings).fetch(request, redirect)` calls platform `fetch`. URLs must be absolute HTTP(S), at most 64 KiB, and contain no embedded credentials. `RedirectMode::Manual` is the default; Follow and Error are explicit options. HTTP error statuses remain responses.

Requests have a 1 MiB total wire budget including method/headers/prefixes; responses allow a 1 MiB body and 64 KiB header wire. Bodies are buffered. The incoming signal is forwarded, but cancellation cannot undo upstream side effects. The SDK does not supply SSRF protection: validate destinations and do not forward credentials across untrusted redirects.

Local tests use an isolated loopback server. For manual use, configure `UPSTREAM_URL` to an origin you control. Streaming, upgrades, per-operation abort handles, and platform-specific fetch options are not exposed here.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
