# libcf

Experimental C++20/23/Wasm bindings for authoring Cloudflare Workers and Durable Objects. **libcf** is the project name; the C++ library is **`cf`** (namespace `cf`, headers `<cf/...>`, Bazel module `cf` and consumer target `@cf//:cf`). **Work in progress:** this is not a complete or production-ready platform SDK. The current code proves a C++/Emscripten module Worker, introduces a small header-only HTTP/router/fetch/crypto API and exercises a subset of bindings locally. See [INVENTORY.md](INVENTORY.md) and [the operation ledger](docs/coverage.md) for planned vs verified scope. Local performance results and methodology are in [benchmarks](docs/benchmarks.md).

## Try the working examples

Use official **Bazel 9.3.0**, directly or through Bazelisk. Bazel downloads pinned Emscripten **6.0.12**, Node **26.11.1** and JS dependencies; native C++ still requires a host compiler/SDK. CMake and npm build/test workflows are no longer supported.

```sh
bazel test //...                         # native, headers, adapters, examples, archive
bazel test //:core_local_test            # one independently runnable example
bazel test --config=cxx23 //:native_tests
bazel build //:all_bundles //:sdk_archive
bazel run //:verify_package -- "$(command -v bazel)"
bazel run //:core_dev                    # local workerd; stop with Ctrl-C
bazel run //:benchmark_spike             # optional rough local comparison
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json # choose a new report path
```

See [Bazel development and verification](docs/bazel.md) and [SDK consumption](docs/packaging.md). The benchmark target requires a new absolute report path and does not include compilation time.

[Core](examples/core/README.md) · [KV](examples/kv/README.md) · [D1](examples/d1/README.md) · [R2](examples/r2/README.md) · [Cache](examples/cache/README.md) · [Service bindings](examples/service/README.md) · [Durable Objects](examples/durable/README.md) · [Queues/scheduling](examples/events/README.md) · [AI JSON (local mock)](examples/ai/README.md) · [Vectorize query (local mock)](examples/vectorize/README.md) · [Dynamic dispatch (mock namespace)](examples/dispatch/README.md) · [Media frame](examples/media/README.md) · [AI Search keywords (local mock)](examples/ai-search/README.md) · [Stream metadata (local simulator)](examples/stream/README.md) · [Browser HTML screenshot (local mock)](examples/browser/README.md) · [Agent Memory list (local mock; get-or-create)](examples/agent-memory/README.md) · [Container inspection (local mock)](examples/container/README.md) · [bridge spike](examples/hello/README.md).

The reusable [JS runtime shim](lib/runtime.mjs) adapts Worker events and bindings; C++ runs as an imported `CompiledWasm` module. See [request ownership and cancellation](docs/request-lifetime.md). The Bazel SDK archive contains the headers, runtime and Worker build rule; package checks compile and run independent native and Wasm consumers. See [SDK packaging and relocation checks](docs/packaging.md). No account, login, remote binding or live deployment is used by these default tests. Isolated live probes have dated results and cleanup evidence; other binding families remain incomplete. Every supported method must have its own verification level before a release claim. Do not use the proof-of-concept KV namespace ID for deployment.
