# Bazel development (migration in progress)

Use the **official Bazel 9.3.0 release binary**, directly or through Bazelisk
(`.bazelversion`). The public header target is `//:cf`;
the Bzlmod module is named `cf`. Packaging and CI are verified; removal of obsolete commands is still in progress.
The declared local test graph is available:

```sh
bazel test //...
bazel test --config=cxx23 //:native_tests
bazel build //:all_workers //:all_bundles
bazel test //:bundles_test
# Individual module, producing bazel-bin/build/rpc.mjs and rpc.wasm:
bazel build //:rpc
```

The JS test runs Node 26.11.1, parses JSONC, bundles the Bazel-generated hello
bridge with esbuild, and executes C++ addition through Wasm in local workerd.
It declares both generated JS/Wasm artifacts and npm dependencies. It does not
read the old source `build/` artifacts, use Cloudflare credentials, or deploy.

`//:all_workers` builds all 25 existing module pairs: 23 Worker examples,
the separate Durable Object implementation and the hello bridge spike. The shared
`src/worker.cpp` compiles once per configuration: action-graph inspection found
26 C++ compilation actions, exactly one belonging to `//:worker_runtime`.
`//tools:worker.bzl` provides the declared compile/link/extraction rule. Public
runtime files are exposed through `//:runtime_modules` and `//:host_library`.

`//:all_bundles` emits 29 JS/Wasm module bundles, including the private upstreams
and plain-JS baselines. Each `bazel-bin/bundles/<name>/` contains `worker.mjs`, a
versioned `bundle.json` inventory and content-addressed static Wasm imports.
For example, `bazel build //:rpc_bundle` builds only that bundle's dependencies.
The bundler is a declared Node action with no deployment, account access or random
resource identity. Bindings, assets and ownership manifests are separate deployment
inputs; these module bundles are not complete prebuilt `cf deploy` directories.
`//:bundles_test` validates all 29 inventories, Wasm hashes/validity and static
imports, then executes the emitted C++ and JS benchmark bundles in workerd.

The upstream Bazel Emscripten toolchain defaults to `-fno-exceptions`, unlike the
previous direct em++ invocation. The rule explicitly allows throw expressions
while retaining `DISABLE_EXCEPTION_CATCHING=1`, matching the previous non-catching
Emscripten policy. It does not add C++ exception recovery or unwinding support.
The first all-example build exposed this mismatch; the corrected build passed,
as did the actual core Worker integration suite and all 19 native suites.

## Dependencies and host requirements

- `MODULE.bazel` pins build rules, Emscripten **6.0.12**, Node **26.11.1** and pnpm
  **10.22.0**. Node archives have explicit official SHA-256 hashes for macOS/Linux
  arm64/x86_64. Emscripten and its Python/tool dependencies use the upstream
  checksum-pinned Bazel module. `MODULE.bazel.lock` records module resolution.
- `pnpm-lock.yaml` preserves all **84** package versions and integrity hashes
  from the committed npm lockfile at migration baseline `ccc0500`. Its direct
  dependencies remain esbuild **0.28.2**, jsonc-parser **3.3.1** and Miniflare
  **5.20261006.1-alpha**, with workerd **1.20261006.1**. The unrelated formatter
  additions in the working npm files are not part of this lock conversion.
- Package install hooks are disabled. Native executables/libraries come from
  integrity-locked optional packages; actual esbuild/workerd execution is checked,
  not inferred from successful imports. Image/sharp functionality still needs its
  existing integration suite migrated and run.
- First use downloads public build dependencies. Normal test execution uses
  local workerd and does not mutate a Cloudflare account. Aspect telemetry is
  disabled through `DO_NOT_TRACK` in `.bazelrc`.
- CI uses Ubuntu 24.04 with GCC **13.3.0** selected and checked,
  a checksum-verified Bazel 9.3.0 binary, the default graph, explicit C++23 and
  ASan/UBSan native runs. A `cf` CLI dry-run consumes Bazel-built modules through
  `//:prepare_live_worker`; npm is used only to install that external CLI, not
  to build or test libcf. Both local and Linux CI dry-runs passed.
- **Native C++ currently uses the host toolchain**, unlike downloaded Emscripten
  and Node. The verified host is Apple clang **17.0.0 (clang-1700.6.3.2)** with
  macOS SDK **26.2**, arm64. Xcode/SDK installation is an external prerequisite;
  this is not a claim of hermetic native compilation or cross-host identical
  output. Linux x86_64 CI uses the checked GCC version above and passes sanitizers.
  macOS x86_64 and Linux arm64 remain unverified.

Bazel outputs are ignored as `/bazel-*`; generated sources live in Bazel output
and runfiles trees. Existing `build/` is excluded from package discovery, not
deleted: it contains retained live-test ownership records and evidence.

## Test coverage during cutover

The default graph currently contains **80 test targets**: 19 native suites,
C++20/23 all-header checks, 24 example/benchmark integration targets, 32 JS
adapter/policy checks, two toolchain/bundle checks and the SDK archive test.
The graph passes locally and in Linux CI; the 21-target native/header suite also
passes under `--config=cxx23`.
Integration targets consume declared Wasm outputs rather than spawning compilers.
The initial all-header attempt omitted `CF_CONSUMER_STANDARD`; the rules now
provide the same explicit standard assertion selector as the previous consumer.

The old CMake installed-package test is **not** counted or run by Bazel. Its
[archive/external-consumer replacement](packaging.md) passes on macOS and Linux.
External consumption runs separately through `bazel run //:verify_package`.
Compiler-spawning integration wrapper files still exist pending command cleanup,
but their example tests run directly through Bazel. Live-policy/readiness/artifact tests are
local simulations; their names do not imply account access or new live evidence.

## Bazel distribution and lockfile

The first Linux CI attempt stopped during analysis: its official Bazel binary
computed a different Emscripten extension digest from the local binary reporting
`9.3.0 Homebrew`. The official macOS binary reproduced the same strict-lock error.
Regeneration with the official binary changed exactly one `bzlTransitiveDigest`,
without changing dependency versions, repository definitions or archive hashes.
All 79 tests then passed, and the native/C++23 suite passed with
`--lockfile_mode=error`. Use the official distribution to avoid rewriting this
version-dependent digest; strict lock checking remains enabled in CI.

## Linux CI evidence

[Run 38487030301](https://github.com/leostera/libcf/actions/runs/38487030301),
commit `92d7a0c`, passed on Ubuntu 24.04/GCC 13.3.0 with official Bazel 9.3.0:

- the complete 79-target default graph with strict lock checking;
- all 21 native/header targets under the C++23 configuration;
- all 21 native/header targets under ASan/UBSan, with a 60-second test timeout;
- preparation using Bazel-built modules and an offline `cf deploy` dry-run.

No Cloudflare account resources were created. Later
[run 38489131176](https://github.com/leostera/libcf/actions/runs/38489131176),
commit `58400d7`, also passed the new archive test (80 default targets total) and
relocated external-consumer checks. The SDK archive matched both independent
macOS builds byte-for-byte; [the report](builds/sdk-2026-10-14.json) records its
source revision and digest. Removal of superseded commands remains unfinished.
GitHub reported a deprecation notice for the pinned checkout/setup-node v4 actions'
internal Node runtime; the project's Node toolchain remains pinned and tested.

## Current evidence

On 2026-10-13, the two toolchain tests passed with
`--nocache_test_results`, including the real Wasm/esbuild/workerd path. The native
core test also passed in explicit C++23 mode.

A separate `git archive` of commit `674ceb3`, with a fresh Bazel output base,
passed both tests with `--lockfile_mode=error --nocache_test_results`. Its PATH
contained only system directories (no Homebrew Node/CMake or local emsdk), and
it had no `node_modules/`, source `build/`, or untracked formatter helper. No source
`build/` directory was created. Downloads could use Bazel's repository cache;
this proves clean-source/input separation, not an empty-download-cache build.

A clean archive of `867fa75` then built all 25 module pairs and passed all 21
selected test targets (19 native suites, core local integration and the toolchain
smoke), using the same locked/system-only-PATH procedure. No source `build/`
directory was created. Two further independent archives of `27dc3bf`, with separate
fresh output bases and the same locked/system-only-PATH procedure, passed the
29-bundle inventory/runtime test. All **83 bundle files were byte-identical**;
[the recorded hashes](builds/bazel-2026-10-13.json) identify the artifacts.
This is same-host repeatability with a shared download cache, not cross-host or
empty-download-cache reproducibility.

These build checks do not replace live verification or the final release audit. See [the migration checklist](bazel-migration.md).
