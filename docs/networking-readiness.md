# Networking readiness

Checked2026-10-14 against workerd `v1.20261006.1`, Miniflare
`5.20261006.1-alpha`, compatibility date `2026-10-13`, current Cloudflare docs and
the previously inventoried workers-types `5.20261010.1` declarations.
A [bounded C++ service TCP client](../examples/service-tcp/README.md) now has native/JS and real C++/Wasm local verification. The bounded client also passed an [isolated live probe](live/bazel-service-tcp-2026-10-14.json) with cleanup. No persistent socket, Hyperdrive or C++ inbound handler support is claimed.

| Path | Evidence and classification |
| --- | --- |
| Outbound TCP | Public `cloudflare:sockets.connect()` API; libcf wrapper still planned. It returns readable/writable streams, opened/closed promises, close and StartTLS. |
| Service-forwarded inbound TCP | Public `connect(socket, env, ctx)` handler, reached through `env.BACKEND.connect(address)`. Actual JS-only byte echo passes in pinned local workerd; Bounded C++ client exchange is locally and live verified; the C++ inbound entrypoint remains unimplemented. |
| Direct public inbound TCP | Current docs explicitly exclude public Internet connections, including HTTP CONNECT to a Worker URL. Service-forwarded ingress is a different capability. |
| Hyperdrive | Worker binding offers context-scoped credentials and an unauthenticated socket; a compatible DB driver must still authenticate/speak the database protocol. No driver, credential transport or query path implemented in libcf. |
| `node:dgram` | Explicitly documented non-functional stub, not UDP support. The pinned implementation's send/connect methods are no-ops. Local test checks stub construction/empty address without sending a datagram. |
| Experimental standalone UDP | Pinned workerd contains UDP ingress and datagram streams behind `workerd_experimental`. This is not evidence of a supported managed Workers UDP API or a working C++/Emscripten UDP path. Keep this separate from the public binding track. |
| `node:net` server | Current Node compatibility docs say `net.Server` is unsupported. Do not infer public listen/accept support from successful module import or from service-forwarded connect handlers. |

## mTLS and VPC are separate capabilities

See the [mTLS/VPC audit](mtls-vpc-readiness.md). Generic fetch/socket shapes and
service-forwarded TCP evidence do not establish client-certificate authentication
or private-network routing. VPC Services fix routing while retaining Host/SNI
semantics; VPC Networks grant broader runtime-selected reachability. Pinned
plugins are remote proxies; ordinary tests reject their declarations. No
certificate, tunnel, private route or account resource was inspected or created
for that audit. Network TCP versus newer Service TCP/TLS documentation requires
separate contract verification, not inferred parity.

## Local proof and the deadlock it exposed

```sh
bazel test //:js_network-platform_test
```

Two actual local Workers exchange bytes `0,1,127,128,255` over a service binding's
native socket streams. The backend implements `connect`, not HTTP echo. The
synthetic address is delivered to that bound Worker, not resolved externally.
No remote proxy, database, account resource or UDP destination is involved.

The first fixture waited for writes to finish before starting reads and timed
out: its echo peer's return stream applied backpressure. The corrected fixture
reads and writes concurrently, caps output at32 bytes and closes the socket on
a three-second internal deadline; the caller also has a five-second deadline.
This is a fixture correction, **not evidence of platform unavailability**.
It does not prove a C++ bridge, arbitrary protocol framing, StartTLS, full
cancellation semantics or production behavior.

## Constraints for implementation

- Keep sockets within their invocation; do not reuse global request-owned I/O.
  Each open socket consumes a platform connection slot. Avoid retries of writes
  whose remote effects are unknown.
- Read and write concurrently where the protocol requires duplex progress.
  Explicitly own handles/buffers, cap queued bytes, observe opened/closed errors,
  settle at most once, and close on cancellation without waiting indefinitely.
  StartTLS invalidates the original socket's readers/writers. The pinned
  service-forwarded handler constructs a socket without a TLS starter; do not
  infer that this path supports the outbound API's TLS/StartTLS options.
- Managed outbound TCP blocks Cloudflare addresses, localhost/private ranges and
  normally port25. A localhost snippet in Node docs does not supersede these
  restrictions. Use HTTP fetch for HTTP rather than repurposing this API.
- Hyperdrive localConnectionString connects directly to the selected database;
  it does **not** establish managed pooling/cache behavior. No existing database
  or credentials may be used without authorization. Never expose binding
  credentials through an example HTTP response or logs.
- A future isolated service-to-service TCP probe can stay behind the existing
  approved HTTPS test-domain boundary; it does not require a public TCP listener.
  Real external TCP/database verification needs a separately authorized endpoint.

## Sources

- [TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), updated2026-10-13.
- [Connect handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/connect/), updated2026-10-13.
- [Node compatibility: non-functional stubs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/#non-functional-stub-modules).
- [Node net](https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/), updated2026-04-23.
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/), updated2026-04-21.
- Pinned workerd [dgram stub](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/node/dgram.ts), [socket definitions](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/workerd/api/sockets.h) and [connect/experimental UDP handlers](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/workerd/api/global-scope.c++).
