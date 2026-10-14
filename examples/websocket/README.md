# C++ Durable Object WebSockets

```sh
bazel build //:websocket
bazel test //:websocket_local_test
```

The default `bazel test //...` suite also builds and runs this example. Connect a WebSocket client to `/rooms/<name>/connect`; `/rooms/<name>/stats` reports durable message counts. The small JS frontend only routes to a named object and forwards the native upgrade response. Upgrade decisions and message/close handling run in C++.

`createDurableObject()` consumes `cf::websocket_accept()` returned by the C++ fetch handler, validates a GET/WebSocket handshake and calls `ctx.acceptWebSocket()`. It retains native socket ownership outside Wasm. Subsequent hibernatable callbacks invoke C++ with trusted metadata, parsed by `cf::websocket_event()` into `WebSocketMessage` (text/bytes), `WebSocketClose` or `WebSocketError`. Check this event before the ordinary `durable_event()` parser; socket events have their own discriminator.

Return `websocket_send_text()`, `websocket_send_bytes()`, `websocket_close()` or `websocket_ignore()`. Message handlers may await bindings before replying; this example commits a SQLite counter increment first. Close/error handlers must return `websocket_ignore()` after any bookkeeping. Failures close with 1011. Incoming frames over the SDK's **1 MiB** limit close with 1009 before C++ message dispatch; output frames are also bounded. Close reasons are at most 123 UTF-8 bytes, and reserved wire close codes are rejected. HTTP paths/headers cannot manufacture socket callback metadata.

Five workerd tests verify text/binary echo and durable effects, per-object isolation, **forced hibernating eviction with the existing socket retained**, server/client close and handler failure, oversized rejection, and refusal to upgrade ordinary HTTP requests. Eviction uses Miniflare's `unsafeEvictDurableObject(..., {webSockets: 'hibernate'})`: the next message reconstructs the Wasm instance, advances a persisted initialization counter from 1 to 2 and retains earlier message state. Native and direct-adapter tests cover event parsing, invalid closes, malformed UTF-8 and bounded output cancellation.

Although current documentation describes automatic Close replies at the pinned compatibility date, the local client-initiated close test timed out without an explicit reply. The adapter calls `close()` after close-handler bookkeeping, including on failure; documentation states this is harmless if already closed.

**Live subset verified:** secure text/binary exchange, durable writes, client/server close, error/limit handling and upgrade guards. After idle, the same connection remained usable while the persisted initialization counter advanced from 1 to 2, demonstrating live reconstruction. This was not forced live eviction; see [deployment evidence and cleanup](../../docs/live-verification.md). This subset does not expose outbound WebSocket connect, standalone Worker socket pairs, socket tags/attachments, per-peer identity, multiple sends/broadcasts, subprotocol negotiation or auto-response configuration. The existing buffered C++ service/DO fetch API cannot forward native upgrade responses, so this example's frontend route stays in JS. Production applications must add their own authorization before returning `websocket_accept()`.

Sources retrieved 2026-10-13: [DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/). Tests use the project's pinned Miniflare, not a separate Vitest installation.
