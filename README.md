# libcf

Write Cloudflare Workers and Durable Objects in **C++20 or C++23**. libcf compiles your application to WebAssembly and connects it to Cloudflare APIs through a shared JavaScript runtime.

Use it to reuse C++ application logic at the edge, handle HTTP requests with coroutines, and access storage and other Worker bindings without writing a separate JavaScript adapter for each operation.

The library is named **`cf`**: namespace `cf`, headers `<cf/...>`, Bazel module `cf`, and consumer target `@cf//:cf`. This is an early, limited SDK—not a C API, a POSIX environment, or full Cloudflare API coverage.

**Just write JavaScript unless you have a good reason to use C++.** libcf is for reusing C++ code and libraries—not a promise of faster Workers. See the [C++ vs JavaScript benchmarks](bench/README.md) and measure your own workload.

## Get started

Install [Bazelisk](https://github.com/bazelbuild/bazelisk) (or official Bazel **9.3.0**) and a native C++ compiler/SDK. Bazel downloads pinned Emscripten **6.0.12**, Node **26.11.1**, and JavaScript dependencies.

```sh
git clone https://github.com/leostera/libcf.git
cd libcf
bazel test //:core_local_test
bazel run //:core_dev
```

Open the local URL printed by the development server. Stop it with Ctrl-C. These commands do not need a Cloudflare account or deploy anything.

A handler looks like this:

```cpp
#include <cf/worker.hpp>

namespace cf {
Task handle(Request request, WorkerContext context) {
  co_return Response::text("Hello from C++!");
}
}
```

Start with the [core example](examples/core/README.md), then try [KV](examples/kv/README.md), [D1](examples/d1/README.md), or [Durable Objects](examples/durable/README.md).

## What you can build

- **HTTP applications:** requests/responses, routing, binary bodies, static assets, buffered outbound HTTP and service bindings.
- **Stateful services:** KV, D1 prepared statements and batches, R2 object operations, Cache, and Durable Object SQLite transactions and alarms.
- **Event-driven applications:** Queue text/byte messages and bounded text batches, scheduled handlers, inbound email dispositions, Workflow operations, and Durable Object WebSockets.
- **Platform integrations:** hashing and random values, timers, metadata, analytics, Images metadata/PNG rotation, and selected AI, search, media, and other binding operations.

See the [example guide](examples/README.md) for individual APIs and limitations. Some specialized integrations currently have only mocked provider tests; an example is not a claim of production parity.

## Use libcf in your project

[SDK integration](docs/packaging.md) covers Bazel dependencies, native consumers, Worker builds, and runtime wiring. To build the SDK archive locally:

```sh
bazel build //:sdk_archive
# bazel-bin/cf-0.1.0.tar.gz
```

Bazel is the supported build system. Headers alone do not supply a Worker runtime. Generated JS/Wasm modules must be bundled with the runtime and application-specific binding configuration before deployment.

## Important boundaries

Payloads are owned and bounded at the C++/JavaScript boundary; many operations buffer bodies rather than stream them. Cancellation does not roll back writes or guarantee that provider work or billing stops. Configure authorization, destination policy, retries, and resource budgets in your application. Example endpoints and resource IDs are not production configuration.

- [Request lifetime and cancellation](docs/request-lifetime.md)
- [Wire formats and limits](docs/wire-boundaries.md)
- [Build and development commands](docs/bazel.md)
- [Contributing](CONTRIBUTING.md)
