# Core C++ Worker example

A bounded HTTP Worker built with the header-only `include/cf/` types, reusable [`lib/runtime.mjs`](../../lib/runtime.mjs), and [`lib/emscripten-host.js`](../../lib/emscripten-host.js) for Emscripten host imports. Its C++ router serves `/hello/:name`, `/echo`, `/header`, `/env/:name`, `/uuid`, `/stream/:count` and `/background/:key`; `/asset` awaits an Assets binding fetch in a C++ coroutine. `worker.mjs` wires the generated Wasm module into the runtime shim, which converts Worker events into owned C++ request data over a length-prefixed ABI and turns C++ responses into JS `Response`s.

```sh
npm ci
npm run test:native
npm run test:core
# or inspect manually:
npm run build:core
node scripts/dev-example.mjs core
curl http://localhost:8787/hello/Ada
curl http://localhost:8787/asset
curl http://localhost:8787/uuid
curl http://localhost:8787/stream/3
curl -X POST --data-binary 'hello' http://localhost:8787/echo
```

Requires Emscripten 6.0.12 and Node 26.11.1. See [cf deployment checks](../../docs/live-verification.md) for the prebuilt packaging path. Local tests verify routing, header and variable access, a binary echo, async asset fetch, streamed responses/cancellation, `waitUntil` KV writes, invalid input, UUIDs, and concurrency. An isolated live probe verified routing, headers/string vars, Assets.fetch, binary echo, stream contents and client cancel/recovery, UUID smoke checks, concurrency and waitUntil persistence. See [live evidence and cleanup](../../docs/live-verification.md); no general runtime or transport-backpressure parity is claimed.

**Boundary contracts:** JS copies request body and headers before entering C++ (1 MiB and 64 KiB limits); the C++ parser validates the header wire format before constructing `Headers`. C++ borrows ABI buffers only for the duration of each call. Coroutines own their request data and resume after the host fetch Promise settles; the adapter tracks in-flight invocations and cancels their C++ handles on request abort. Bounded responses use owned bytes; stream responses own a `StreamSource` that is pulled on demand and dropped on close/cancel. The current `Fetcher` example returns a bounded body and status only—streaming fetch and response-header APIs are future work. `Context::wait_until` currently supports typed KV-put and fetch work descriptions, not arbitrary C++ futures.
