# libcf

Experimental C++20/Wasm bindings for authoring Cloudflare Workers. **Work in progress:** this is not a complete or production-ready platform SDK. The current code proves a C++/Emscripten module Worker, introduces a small header-only HTTP/router/fetch/crypto API and exercises a subset of bindings locally. See [INVENTORY.md](INVENTORY.md) and [the operation ledger](docs/coverage.md) for planned vs verified scope.

## Try the working examples

Use Emscripten **6.0.12** (`em++` on `PATH`) and Node **26.11.1** (`.node-version`):

```sh
npm ci
npm run test:native  # CMake / C++ unit tests
npm run test:spike   # proof of KV, assets, streaming and waitUntil
npm run test:core    # C++ HTTP/router/Env/coroutine fetch/crypto
npm run bench:spike  # optional rough local comparison to plain JS
```

[Core example](examples/core/README.md) · [bridge spike](examples/hello/README.md).

The JS module shim adapts Worker events and bindings; C++ runs as an imported `CompiledWasm` module. No account, login, remote binding or live deployment is used by these default tests. Live tests and more binding families are planned, and every supported method must have its own verification level before a release claim. Do not use the proof-of-concept KV namespace ID for deployment.
