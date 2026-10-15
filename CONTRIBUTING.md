# Contributing to libcf

Keep changes focused on an application use case. Describe the API behavior, limits, and error handling in your pull request; add or update an independently runnable example when introducing a public feature.

## Set up

Use official Bazel **9.3.0** or Bazelisk, plus a native C++ compiler/SDK. Emscripten, Node, and JavaScript dependencies are pinned in the Bazel dependency graph. Do not replace dependency integrity hashes to work around download failures.

```sh
bazel test //:core_local_test
bazel test //...
bazel test --config=cxx23 //:native_tests
bazel build //:all_bundles //:sdk_archive
bazel run //:verify_package -- "$(command -v bazel)"
```

See [Bazel commands](docs/bazel.md) for focused tests, local development, and bundle outputs. C++23 Worker sources require `cf_worker(cxx_standard = 23)`; the native `--config=cxx23` flag does not change that attribute.

## Repository layout

- `include/cf/`: public C++ API and wire helpers.
- `src/worker.cpp`: shared Wasm bridge.
- `lib/`: JavaScript runtime and binding adapters.
- `examples/`: applications, configuration, and local integration tests.
- `tests/native/`: C++ tests; `tests/*.test.mjs`: adapter and runtime tests.
- `tools/`, `packaging/`: Bazel rules and distributable SDK.

## API and test expectations

Use namespace `cf` and `<cf/...>` headers. Model valid inputs and outcomes explicitly, preserve absent versus empty values, and reject malformed host replies. Copy borrowed data before asynchronous suspension; retain provider receivers and request ownership through completion. Cleanup must not hide the primary error. Do not automatically retry mutations whose outcome is unknown.

Test public operations at three useful boundaries: native C++ encoding/decoding, JavaScript adapter behavior, and actual Wasm execution in local workerd. Add negative, limit, cancellation, and recovery cases as appropriate. Mock providers test adapter behavior, not provider support. See [request lifetime](docs/request-lifetime.md), [wire boundaries](docs/wire-boundaries.md), and [platform contract tests](docs/platform-contracts.md).

Keep default tests local and independent of account credentials. Preserve functional fixture manifests, JSON configuration, and artifact-packaging tests; these are inputs to tests, not historical reports. Do not commit generated benchmark reports or development logs.

## Formatting

The checkout includes C++ formatting/lint helpers in `scripts/cpp-tools.sh`. Use clang-format **21.1.8**; `CLANG_FORMAT` and `CLANG_TIDY` can override executable discovery.

```sh
npm run format:cpp:check
npm run format:cpp
npm run format:check
```

These are style helpers, not an alternative build/test system. The current `lint:cpp` helper still depends on CMake configuration and is not part of the supported Bazel workflow. Do not reintroduce CMake build support to run it. Keep unrelated formatting changes out of feature patches.

## Optional live testing

Live tests require explicit ownership, authorization, cost bounds, and independent cleanup. Use the **cf CLI**, not Wrangler subprocesses. Repository probes use isolated names and only `*.libcf.leostera.dev`, with workers.dev and preview URLs disabled. Never reuse unrelated resources, credentials, certificates, or production data.

Preparation targets only create local deployment inputs; they do not authorize deployment. Keep the generated ownership manifest until all resources are removed. Confirm cleanup even after a failed deployment or probe. A successful build, upload, or deployment is not a runtime test. Do not run account operations as part of a documentation change.

## Before submitting

Run focused tests, the default suite, and package checks when changing distributed files. Update usage documentation and state limitations plainly. Do not add internal task lists, coverage inventories, dated verification reports, or historical logs to the user documentation. Release publication is a separate explicit step.
