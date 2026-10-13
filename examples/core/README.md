# Core C++ Worker example

A bounded HTTP Worker built with the header-only `include/libcf/` types. Its C++ router serves `/hello/:name`, `/echo`, `/header`, `/env/:name` and `/uuid`; `/asset` awaits an Assets binding fetch in a C++ coroutine. The module entrypoint in `worker.mjs` adapts Worker request data into an owned C++ request over a length-prefixed C ABI, and turns the C++ response back into a JS `Response`.

```sh
npm ci
npm run test:native
npm run test:core
# or inspect manually:
npm run build:core
npx wrangler dev --config examples/core/wrangler.jsonc --local
curl http://localhost:8787/hello/Ada
curl http://localhost:8787/asset
curl http://localhost:8787/uuid
curl -X POST --data-binary 'hello' http://localhost:8787/echo
```

Requires Emscripten 6.0.12 and Node 26.11.1. `wrangler deploy --config examples/core/wrangler.jsonc --dry-run` checks packaging without deploying. Local tests verify routing, header and variable access, a binary echo, async asset fetch, invalid input, UUIDs, and concurrency. No remote parity is claimed.

**Boundary contracts:** JS copies request body and headers before entering C++ (1 MiB and 64 KiB limits); the C++ parser validates the header wire format before constructing `Headers`. C++ borrows ABI buffers only for the duration of each call. Coroutines own their request data and resume after the host fetch Promise settles; the adapter tracks in-flight invocations and cancels their C++ handles on request abort. Response bodies for this example are buffered; the separate [spike](../hello/README.md) proves a pull-based stream, not a finished streaming API. The current `Fetcher` example returns a bounded body and status only—header/streaming fetch response APIs are future work.
