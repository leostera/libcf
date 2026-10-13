# libcf

Experimental C++20/Wasm bindings for authoring Cloudflare Workers. **libcf** is the project name; the C++ library is **`cf`** (namespace `cf`, headers `<cf/...>`, CMake `find_package(cf)` and target `cf::cf`). **Work in progress:** this is not a complete or production-ready platform SDK. The current code proves a C++/Emscripten module Worker, introduces a small header-only HTTP/router/fetch/crypto API and exercises a subset of bindings locally. See [INVENTORY.md](INVENTORY.md) and [the operation ledger](docs/coverage.md) for planned vs verified scope.

## Try the working examples

Use Emscripten **6.0.12** (`em++` on `PATH`) and Node **26.11.1** (`.node-version`):

```sh
npm ci
npm test            # C++ unit + installed-package + all local Worker suites
npm run test:spike   # proof of KV, assets, streaming and waitUntil
npm run test:core    # HTTP/router/Env/coroutine fetch/stream/crypto
npm run bench:spike  # optional rough local comparison to plain JS
```

[Core](examples/core/README.md) · [KV](examples/kv/README.md) · [D1](examples/d1/README.md) · [R2](examples/r2/README.md) · [Cache](examples/cache/README.md) · [bridge spike](examples/hello/README.md).

The reusable [JS runtime shim](lib/runtime.mjs) adapts Worker events and bindings; C++ runs as an imported `CompiledWasm` module. The C++ headers are installable via CMake (`cf::cf`); the package test installs them and compiles an independent consumer. No account, login, remote binding or live deployment is used by these default tests. Live tests and more binding families are planned, and every supported method must have its own verification level before a release claim. Do not use the proof-of-concept KV namespace ID for deployment.
