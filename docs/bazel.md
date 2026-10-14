# Bazel development

Use **Bazelisk** to select the official Bazel **9.3.0** release from
`.bazelversion`, or install that official release directly. The public header
target is `//:cf`; the Bzlmod module is named `cf`.

On macOS with Homebrew:

```sh
# Only if the standalone Homebrew bazel formula is already linked:
brew unlink bazel
brew install bazelisk
bazel --version # must report bazel 9.3.0, without the Homebrew suffix
```

`.bazelversion` selects a binary through Bazelisk; it cannot change the version of
an already-installed standalone Bazel executable. The Homebrew-built `bazel`
formula embeds `9.3.0 Homebrew` in the generated `bazel_features` version file.
That file is transitively loaded by the Emscripten extension, changing its lock
digest. Do **not** regenerate the project lock with that binary to clear the
error: it would then fail with the official binary used in CI.

After switching this development machine to Bazelisk 1.29.0, ordinary
`bazel test //...` passed all 81 targets and `bazel build //...` succeeded with
197 targets, without changing `MODULE.bazel.lock`.

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

`//:all_workers` builds all 27 existing module pairs: 25 Worker examples,
the separate Durable Object implementation and the hello bridge spike. The shared
`src/worker.cpp` compiles once per configuration: action-graph inspection found
26 C++ compilation actions, exactly one belonging to `//:worker_runtime`.
`//tools:worker.bzl` provides the declared compile/link/extraction rule. Public
runtime files are exposed through `//:runtime_modules` and `//:host_library`.

`//:all_bundles` emits 32 JS/Wasm module bundles, including the private upstreams
and plain-JS baselines. Each `bazel-bin/bundles/<name>/` contains `worker.mjs`, a
versioned `bundle.json` inventory and content-addressed static Wasm imports.
For example, `bazel build //:rpc_bundle` builds only that bundle's dependencies.
The bundler is a declared Node action with no deployment, account access or random
resource identity. Bindings, assets and ownership manifests are separate deployment
inputs; these module bundles are not complete prebuilt `cf deploy` directories.
`//:bundles_test` validates all 32 inventories, Wasm hashes/validity and static
imports, then executes the emitted C++ and JS benchmark bundles in workerd.

The upstream Bazel Emscripten toolchain defaults to `-fno-exceptions`, unlike the
previous direct em++ invocation. The rule explicitly allows throw expressions
while retaining `DISABLE_EXCEPTION_CATCHING=1`, matching the previous non-catching
Emscripten policy. It does not add C++ exception recovery or unwinding support.
The first all-example build exposed this mismatch; the corrected build passed,
as did the actual core Worker integration suite and all 19 native suites.

## Opt-in development and live commands

`bazel run //:core_dev` starts local workerd and builds its module first. Equivalent
`*_dev` targets exist for hello, KV, D1, R2, Cache, service, durable and events.
All advertised families also have independent `*_local_test` targets.

Live preparation and probes are **manual run targets**, not default tests:

```sh
bazel run //:prepare_live_worker -- cache
# Preflight ownership before any deployment, then use the cf CLI in build/live-cache.
bazel run //:live_cache -- <owned-hostname>
```

Preparation writes to the source workspace's `build/live-<family>/`, never Bazel's
disposable runfiles/output tree. An existing output directory is rejected instead
of overwriting its manifest. For a retry, retain/move the old directory only after
independently verifying cleanup of all resources it identifies. Do not erase active
ownership evidence merely to clear an `EEXIST` error.

The events probe has a separate elapsed Cron-observation budget: 20 minutes by
default, configurable with `LIBCF_LIVE_CRON_TIMEOUT_MS` (1..3600000 ms). That
single deadline covers HTTP, bounded 64-KiB response bodies and retry sleeps.
Longer observation is opt-in and does not constitute delivery evidence. The internal
Cron control uses the same timeout setting, interrupts in-flight CLI queries at
the deadline, and retains fresh per-command budgets for cleanup. Its CLI output
is separately bounded to 1 MiB per command.

Cron preparation compares canonical Wasm paths: esbuild may resolve a runfile
symlink to its physical artifact path. Regression tests accept aliases of the
declared module and reject different files even when their names/bytes match.
The actual Bazel executable also passed offline preparation of both controls.

Probe target names replace family hyphens with underscores, for example
`//:live_http_client`, `//:live_rate_limit` and `//:live_rpc`. Arguments and bounded
readiness settings are unchanged. `//:prepare_cron_control` prepares the plain-JS
and C++ scheduled controls; `//:live_cron_control` requires an explicit manifest
path and `--cleanup`. Workflow readback and Cron cleanup require the authenticated
`cf` CLI on PATH. These targets do not grant approvals for fee-sensitive bindings.

`//:benchmark_sdk` consumes prebuilt modules and requires a new absolute report
path. A short two-round/five-sample smoke run passed after migration; it verifies
execution and report generation, not a useful performance comparison. Schema 2
reports use `buildMilliseconds: null` because compilation happens before execution.

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

The default graph currently contains **92 test targets**: 21 native suites,
C++20/23 all-header checks, 26 example/benchmark integration targets, 40 JS
adapter/policy checks, two toolchain/bundle checks and the SDK archive test.
The graph passes locally; the CI evidence below identifies verified revisions.
The native/header suite now contains 23 targets, also tested with `--config=cxx23`.
The AI integration uses an explicitly mocked provider inside workerd, not remote
inference; the local harness rejects production AI binding configurations.
Integration targets consume declared Wasm outputs rather than spawning compilers.
The initial all-header attempt omitted `CF_CONSUMER_STANDARD`; the rules now
provide the same explicit standard assertion selector as the previous consumer.

The old CMake installed-package test and compiler-spawning integration wrappers
have been removed. Their [archive/external-consumer replacement](packaging.md)
passes on macOS and Linux. External consumption runs separately through
`bazel run //:verify_package`; example tests run directly through Bazel. Live-policy/readiness/artifact tests are
local simulations; their names do not imply account access or new live evidence.

## Bazel distribution and lockfile

The first Linux CI attempt stopped during analysis: its official Bazel binary
computed a different Emscripten extension digest from the local binary reporting
`9.3.0 Homebrew`. The official macOS binary reproduced the same strict-lock error.
Regeneration with the official binary changed exactly one `bzlTransitiveDigest`,
without changing dependency versions, repository definitions or archive hashes.
All 79 tests then passed, and the native/C++23 suite passed with
`--lockfile_mode=error`. Use the official distribution to avoid rewriting this
version-dependent digest. Strict lock checking is now the project default, not
just a CI flag; deliberate dependency changes require an explicit
`--lockfile_mode=update` invocation with the official binary.

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
source revision and digest.

[Run 38491371895](https://github.com/leostera/libcf/actions/runs/38491371895),
commit `3eee351`, passed after CMake/compiler-wrapper removal and persistent live
output preparation: all 81 default targets, C++23, sanitizers, external consumption
and offline deployment preparation/dry-run. No live resource was created.
GitHub reported a deprecation notice for the pinned checkout/setup-node v4 actions'
internal Node runtime; the project's Node toolchain remains pinned and tested.

[Run 38499755964](https://github.com/leostera/libcf/actions/runs/38499755964),
commit `73fc3a2`, passed all 83 default tests and the C++23, sanitizer, package
and offline dry-run jobs. The preceding
[run 38498719521](https://github.com/leostera/libcf/actions/runs/38498719521)
failed the clock example's `/same-turn` check with HTTP 502. That response body
was not captured; 30 fresh local repetitions passed. Inspection of the pinned
workerd source then established that its local `TimerChannel::now` reads the
system clock rather than freezing it between I/O. The example now returns all
33 synchronous samples: local tests check every sample against the JS bracket;
the live probe still requires all samples to be equal. A mocked live-probe test
rejects advancing samples. See the [clock example](../examples/clock/README.md)
for the pinned source and the distinction between transport and platform policy.
No retry hides the original failure; error messages retain response body/path.
[Run 38501440558](https://github.com/leostera/libcf/actions/runs/38501440558),
commit `0c3b229`, passed all 84 default tests, C++23, sanitizers, package consumers
and offline dry-run after this correction. The revised
[clock live probe](live/bazel-clock-2026-10-14.json) also passed with cleanup.
[Run 38503312280](https://github.com/leostera/libcf/actions/runs/38503312280),
commit `a7a624f`, then passed 85 default tests and the remaining CI checks after
the documented decimal-KB Queue producer guard correction.

[Run 38507665288](https://github.com/leostera/libcf/actions/runs/38507665288),
commit `5a00b22`, passed 88 default tests, 22 C++23 native/header targets,
22 ASan/UBSan targets and relocated native20/23 plus Worker23 consumers of the
80-file SDK. The added AI integration is explicitly **mock-only**, not real
inference or native AI service verification. No account usage or live resources
were involved. This revision has no new cross-host archive-identity claim.

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
