# Bazel development (migration in progress)

Use Bazel **9.3.0** (`.bazelversion`). The public header target is `//:cf`;
the Bzlmod module is named `cf`. Full examples, packaging and CI are still being
migrated; the following build/test paths are available:

```sh
bazel test //:native_tests //:node_toolchain_test //:core_local_test
bazel test --config=cxx23 //:native_core_test
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
- **Native C++ currently uses the host toolchain**, unlike downloaded Emscripten
  and Node. The verified host is Apple clang **17.0.0 (clang-1700.6.3.2)** with
  macOS SDK **26.2**, arm64. Xcode/SDK installation is an external prerequisite;
  this is not a claim of hermetic native compilation or cross-host identical
  output. Linux CI compiler selection and sanitizer verification remain part of
  the CI migration. Other declared Node host architectures are not yet verified.

Bazel outputs are ignored as `/bazel-*`; generated sources live in Bazel output
and runfiles trees. Existing `build/` is excluded from package discovery, not
deleted: it contains retained live-test ownership records and evidence.

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
directory was created. The 29-bundle inventory/runtime test also passes in the
working tree; independent clean-output bundle comparison is pending.

This does not replace all-header consumer checks, remaining integration tests, live verification
or release reproducibility checks. See [the migration checklist](bazel-migration.md).
