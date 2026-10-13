# Bazel 9.3.0 migration

Status: build-path audit complete; migration implementation pending.

The agreed destination is **Bazel-only**, including tests, CI and packaging.
CMake exports and `find_package(cf)` compatibility are intentionally removed at
cutover. The C++ namespace `cf`, `<cf/...>` headers and libcf branding remain.
This document is a migration checklist, not evidence that Bazel builds pass.

## Audited baseline

Baseline commit: `53a68bed4915a35f4ad61ea8d92bfe03aa85bbf1`.
Its existing CI passed in GitHub Actions run `38468544748`. The audit also examined
the current working tree, which contains concurrent formatter changes.

| Current path | Inputs and outputs | Bazel replacement / verification |
| --- | --- | --- |
| `CMakeLists.txt` | Header-only `cf` interface, 19 native suites, optional ASan/UBSan | Public `cc_library`, native `cc_test` targets, explicit C++20/23 and sanitizer configurations |
| `scripts/build-worker.mjs` | `src/worker.cpp`, example source, headers and `lib/emscripten-host.js`; 24 `.mjs`/`.wasm` pairs, including the separate DO object | Declared Emscripten compile/link actions and artifacts, without compiler subprocesses in tests |
| `scripts/build-spike.mjs` | Hello bridge source and host library; `spike.mjs`/`.wasm` | Separate declared bridge example target |
| `examples/*/worker.mjs` | Static Wasm imports and JS runtime imports, currently relative to `build/` | Example module/bundle targets with complete declared input closure |
| `examples/test/local-worker.mjs` | JSONC fixtures, esbuild, Miniflare/workerd, Wasm, optional upstreams/assets | Runfiles-safe local fixture support; bounded temporary output and disposal |
| `tests/*.test.mjs` | 48 root test files; some compile examples as a side effect | JS test targets, with Wasm dependencies built before tests execute |
| `examples/*/test/*.test.mjs` | 23 example test files; core suites currently orchestrated by npm | Independent local example test targets; avoid duplicating tests through old integration wrappers |
| `tests/package/`, `tests/installed-package.test.mjs` | Consumer, C++20/23 all-header checks, CMake relocation and installed adapter closure | Bazel external-consumer and archive tests; retain inventory/import-closure and no-source-fallback assertions, not CMake layout assertions |
| `scripts/build-live-worker.mjs` | Bundles existing Wasm; creates random isolated deployment identities and `.cloudflare/output/v0` plus ownership manifest | Separate deterministic artifact build from opt-in, uncached preparation of owned deployment directories |
| `scripts/test-live-*.mjs`, Workflow readback helper | Explicit manifests, bounded requests, `cf` readback where needed | Explicit opt-in run targets; never included in ordinary local test execution |
| `scripts/dev-example.mjs` | Local development launcher | Bazel run target consuming built artifacts |
| `scripts/bench-sdk.mjs`, `scripts/bench-spike.mjs` | Builds/loads examples; measures local runtime and emits reports | Bazel run targets with prebuilt C++ and JS variants; preserve source/artifact/toolchain provenance |
| `.github/workflows/ci.yml` | npm orchestration, installed Emscripten, CMake tests/install/sanitizers, deployment dry-run | Pinned Bazel setup, builds/tests/package checks, sanitizers and an offline deployment artifact/dry-run path |
| `README.md`, example READMEs, `docs/packaging.md`, `AGENTS.md` | npm/CMake build and consumption instructions | Bazel commands and external module/target documentation; no advertised fallback build |

The source inventory is not a new coverage claim. Preserve the existing
36-public-header / 41-operation ledger and its local/live distinctions while
changing build orchestration.

## Toolchain and dependency boundary

- Bazel: exactly **9.3.0**, locally confirmed; use Bzlmod and checked-in locking.
- Preserve Emscripten **6.0.12**, Node **26.11.1**, esbuild **0.28.2**,
  jsonc-parser **3.3.1**, Miniflare **5.20261006.1-alpha** and its locked workerd
  dependency unless a separately documented incompatibility requires a change.
- Preserve Worker compatibility date **2026-10-13**.
- Pin build rules and downloaded tools; verify the Emscripten cache, compiler
  sysroot, host architecture and executable Node package dependencies are usable
  in sandboxed actions. Record any unavoidable host compiler/platform dependency.
- The `cf` CLI **1.0.0-beta.6** is the approved deployment interface. Account
  credentials are external opt-in runtime inputs, never build inputs or files
  in a distributable package. Do not replace it with Wrangler subprocesses.
- Dependency installation must not accidentally incorporate the concurrent
  formatter's uncommitted `oxfmt` addition into migration commits.

## Execution order

1. Establish version pinning, Bzlmod and native/Emscripten/Node toolchains.
2. Build the library and every example from declared source/tool inputs. Preserve
   the existing ABI exports and Emscripten flags until separately verified changes
   are necessary. Do not require a pre-populated source `build/` directory.
3. Move tests to built dependencies and runfiles-safe fixtures. Exercise native,
   JS boundary, actual workerd, multi-Worker, DO restart and event cases. Validate
   C++20/23 and Linux sanitizer configurations.
4. Produce a reproducible archive and verify an independent Bazel consumer with
   no source-tree fallback. Check every public header, runtime adapter and Worker
   source; test relocated artifact imports and missing-dependency rejection.
5. Switch CI and documented commands, then remove CMake machinery, npm build/test
   orchestration and compiler-spawning wrappers. Preserve necessary JS adapters
   and dependency metadata, not parallel build implementations.
6. Re-run applicable opt-in live checks with Bazel-built artifacts and matched JS
   benchmarks. Only then resume binding expansion and the wider release audit.

## Ownership and safety

The audit recorded 135 modified tracked files and separately saved the unstaged
patch, status and untracked formatter configuration/tool script under ignored
`.pi/bazel-precutover/`. That snapshot is a recovery aid, not permission to
revert or stage another task's changes. Inspect each shared file before editing;
commit only migration changes and preserve later concurrent edits too.

The already-running RPC probe owns a frontend and private upstream. Its active
manifest and deployment directory must remain unchanged until cleanup is verified.
Do not delete `build/` to demonstrate a clean build while it contains ownership
manifests or active artifacts. Use an isolated clean checkout/output base for that
verification. Retain historical live evidence and benchmark reports.

Random live identities and remote mutations must not become cacheable build
outputs/actions. Default tests must not provision resources or require Cloudflare
credentials. Deployment success is not runtime verification, and prior live passes
are not automatically proof about newly built artifacts.
