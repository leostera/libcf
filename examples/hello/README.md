# C++/Emscripten Workers feasibility spike

This is a **working experimental bridge**, not the public libcf API. Prerequisites: Emscripten **6.0.12**, Node.js **26.11.1** (`.node-version`) and `npm ci` (Wrangler **4.149.0** / Miniflare **5.20261006.1-alpha** pinned in the root lockfile).

```sh
npm run test:spike        # compile C++, start Wrangler dev --local, test six behaviors
npm run bench:spike       # optional local/rough comparison to plain JS
npm run build:spike
npx wrangler dev --config examples/hello/wrangler.jsonc --local
# in another terminal: curl 'http://localhost:8787/?a=17&b=25'
# curl 'http://localhost:8787/asset'
# curl 'http://localhost:8787/write?key=foo&value=bar'
# curl 'http://localhost:8787/get?key=foo'
# curl 'http://localhost:8787/stream?count=3'
npx wrangler deploy --config examples/hello/wrangler.jsonc --dry-run
```

The static `CompiledWasm` import is instantiated by generated `build/spike.mjs` glue; no fetching a `.wasm` URL at runtime. `src/spike.cpp` exports a small C ABI and imports host functions from `src/host.js` (Emscripten JS library). `worker.mjs` is the module event handler and JS platform adapter. Each async operation gets a monotonic ID and a per-operation Promise; the JS host copies all borrowed C++ bytes **before** scheduling asynchronous work. When KV or asset fetch settles, JS copies the result into Wasm memory, resumes C++, C++ formats/handles the result, and JS resolves the Response. A streaming Response invokes C++ once per underlying `ReadableStream.pull()`, rather than creating all chunks at once in the handler. `ctx.waitUntil()` attaches the KV write to the request lifecycle even when `/write` returns 202 immediately.

**Why C ABI + small JS shim:** explicit byte ownership, stable exported functions, and no dependency on Rust's wasm-bindgen/worker-build Emscripten integration. Embind remains a candidate for ergonomic/high-level adapters but is not needed for this narrow proof; no measured Embind comparison has been made. This is *not* proof that Emscripten POSIX sockets, filesystem, multi-threading or Asyncify work in libcf.

**Limits before hardening:** the spike handles text, not arbitrary binary response bodies; assumes UTF-8; has no timeout/abort listener on outstanding KV/asset Promises and no general type/error model. Emscripten heap views must be refreshed after growth, and pointers must not escape synchronous calls. Underlying stream pulls are demand-driven but HTTP can coalesce chunks or eagerly drain the stream; the test does **not** establish end-to-end transport backpressure. Shared mutable request state lives only in a JS pending-operation map and must be cleaned on cancellation/timeout in the production core. Never treat this demo's `id` allocator or KV text conversion as finished library design. The default suite uses only local resources; no Cloudflare account or deployment is used.

## Local measurement (one run; not a production benchmark)

2026-10-13, macOS arm64, Node 26.11.1, Emscripten 6.0.12, Wrangler 4.149.0 / local workerd through `wrangler dev --local`:

| Variant | Source/artifact bytes | Startup + first local response | First request from client | Median HTTP round trip (100 sequential after 30 warmups) |
|---|---|---:|---:|---:|
| Plain JS comparator | 329 bytes JS | 824.5 ms | 91.01 ms | 1.55 ms |
| C++ C-ABI Wasm | 7,131 bytes generated JS + 10,015 bytes Wasm | 823.8 ms | 110.13 ms | 1.74 ms |

Numbers include Wrangler startup/local HTTP/network and are noisy, not isolate cold starts or pure bridge timings. The JS comparator only implements arithmetic; the C++ artifact also implements KV, asset fetch, streaming, and waitUntil. Re-run `npm run bench:spike` for the current machine; measure matched functionality and allocations before performance claims.
