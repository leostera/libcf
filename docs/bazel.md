# Build and develop with Bazel

Use **Bazelisk** or official **Bazel 9.3.0**, plus a native C++ compiler/SDK. `.bazelversion` selects the release for Bazelisk; it cannot change a standalone executable. On macOS, prefer `brew install bazelisk` over the Homebrew-built Bazel formula, whose version metadata can change dependency lock digests.

## Build and test

```sh
bazel test //...                         # local default suite
bazel test //:core_local_test            # one example
bazel test //:native_events_test         # one native API suite
bazel test //:js_queue-adapter_test      # one JS adapter suite
bazel test --config=cxx23 //:native_tests
bazel build //:all_workers //:all_bundles
bazel build //:sdk_archive
bazel run //:verify_package -- "$(command -v bazel)"
```

Bazel downloads pinned Emscripten, Node, and JavaScript dependencies. Default tests require no Cloudflare account and do not deploy or use remote bindings. Native builds use your host compiler and SDK. Linux CI also runs sanitizer tests.

`--config=cxx23` selects the native test standard. For Wasm, set `cf_worker(cxx_standard = 23)` explicitly; its default is C++20. The shared bridge is compiled in C++20. Wasm exception catching/unwinding is disabled.

## Run an example

```sh
bazel run //:core_dev
# Stop with Ctrl-C.
bazel build //:kv
bazel test //:kv_local_test
```

Development targets also exist for hello, KV, D1, R2, Cache, service, durable, and events. Specialized bindings may require dedicated local fixtures rather than the generic development helper; use their example README.

## Outputs

`bazel build //:core` produces `bazel-bin/build/core.mjs` and `core.wasm`.
`bazel build //:core_bundle` produces `bazel-bin/bundles/core/`, containing a bundled entrypoint, static Wasm modules, and `bundle.json` module metadata.

Bundles are not complete deployment manifests. Binding configuration, assets, service peers, and resource ownership belong to the application. Legacy Sites additionally requires the imported `__STATIC_CONTENT_MANIFEST` text module; bundling does not upload assets or invent the manifest.

Reusable rules are in `tools/worker.bzl`; the public header target is `//:cf`. See [SDK integration](packaging.md) for external consumers.

## Optional tools

```sh
bazel run //:benchmark_spike
bazel run //:benchmark_sdk -- /tmp/libcf-benchmark.json
```

Choose a new absolute report path. See [benchmark methodology](benchmarks.md). Build time is not included.

Live preparation/probe targets are opt-in and require the [contribution safety rules](../CONTRIBUTING.md#optional-live-testing). `bazel run //:prepare_live_worker -- <family>` creates local inputs in `build/live-<family>/` and refuses to overwrite an existing directory. Do not delete an ownership manifest while its resources remain active. No build command deploys a Worker.
