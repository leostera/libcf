# Durable Object WebSockets

```sh
bazel build //:websocket
bazel test //:websocket_local_test
```

Connect to `/rooms/<name>/connect`; `/rooms/<name>/stats` reports durable message counts. The JS frontend forwards upgrades; C++ decides acceptance and processes hibernatable callbacks through `cf::websocket_event`.

Return `websocket_accept`, `websocket_send_text`, `websocket_send_bytes`, `websocket_close`, or `websocket_ignore` as appropriate. Close/error handlers must return ignore after bookkeeping. Message handlers may await storage before replying. Frames are capped at 1 MiB; close reasons at 123 UTF-8 bytes. Failures close with 1011, oversized input with 1009. Local tests exercise hibernation and reconstruction with an existing socket.

Add authorization before accepting a connection. Outbound WebSockets, standalone Worker pairs, tags/attachments, broadcasts, subprotocol negotiation, and auto-response configuration are not exposed. Buffered C++ fetch cannot forward native upgrade responses, so the frontend stays in JS.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
