# Integrate libcf with Bazel

Use official Bazel **9.3.0**, directly or through Bazelisk. No package publication
is performed by these commands, and no CMake consumer interface is provided.

```sh
bazel build //:sdk_archive
bazel test //:sdk_archive_test
bazel run //:verify_package -- "$(command -v bazel)"
```

The output is `bazel-bin/cf-0.1.0.tar.gz`, rooted at `cf-0.1.0/`. It contains all
public/detail headers, every JS host adapter, `src/worker.cpp`, reusable Bazel
rules, pinned dependency metadata and this README. It excludes examples, tests,
built artifacts, account configuration, credentials and CMake files. Archive file
modes are 0644, owner/group IDs are zero and modification times are zero.

## Native consumer

Add to your `MODULE.bazel`, substituting the archive's URL and SHA-256 integrity:

```starlark
bazel_dep(name = "cf", version = "0.1.0")
archive_override(
    module_name = "cf",
    urls = ["file:///absolute/path/cf-0.1.0.tar.gz"],
    integrity = "sha256-<base64-encoded-SHA256>",
    strip_prefix = "cf-0.1.0",
)
bazel_dep(name = "rules_cc", version = "0.2.26")
```

For local development, an extracted archive can instead be selected with
`local_path_override(module_name = "cf", path = "/absolute/path/cf-0.1.0")`.
Do not specify both overrides. Use an archive you built or a published release with
its matching checksum; the version declaration alone does not install an unpublished module.

Consumer `BUILD.bazel`:

```starlark
load("@rules_cc//cc:defs.bzl", "cc_binary")

cc_binary(
    name = "app",
    srcs = ["main.cpp"],
    copts = ["-std=c++20"],  # C++23 is also supported.
    deps = ["@cf//:cf"],
)
```

Include headers as `<cf/http.hpp>`, `<cf/router.hpp>`, etc. The header target does
not implement native host callbacks or supply a Cloudflare runtime. Native builds
use your host compiler/SDK. The SDK's `.bazelrc` is deliberately not shipped or
implicitly inherited; select your native language standard explicitly. Commit the
consumer's own module lockfile: dependency-module locks do not replace root
application dependency resolution.

## Worker / Durable Object module

```starlark
load("@cf//tools:worker.bzl", "cf_worker")

cf_worker(
    name = "worker",
    srcs = ["worker.cpp"],
    cxx_standard = 23,  # Defaults to 20; only 20 and 23 are accepted.
)
```

`bazel build //:worker` produces `bazel-bin/build/worker.mjs` and `worker.wasm`.
The rule supplies the Emscripten toolchain, SDK bridge, language standard and
required ABI exports. The shared bridge compiles in C++20; application sources
may use C++20 or C++23. Throws are permitted but Wasm exception catching/unwinding
remains disabled, matching the existing SDK policy.

`@cf//:runtime_modules` exposes the JS adapters and
`@cf//:host_library` exposes the Emscripten import library. Bundle the generated
module with `lib/runtime.mjs` and a static compiled-Wasm import as demonstrated by
the repository examples. The archive keeps adapter-relative imports intact.
For example, place this entrypoint alongside the generated `worker.mjs` and
`worker.wasm`, with the archive runtime copied intact into `lib/`:

```js
import factory from "./worker.mjs";
import wasm from "./worker.wasm";
import { createWorker } from "./lib/runtime.mjs";

export default createWorker(factory, wasm);
```

Use a Worker-aware bundler that preserves the static Wasm import as a compiled
Wasm module. Keep all runtime adapter-relative imports available. The repository's
`tools/bundle-worker.mjs` shows the bundling setup. Durable Objects need a separate
object module and `createDurableObject` export; see the repository's durable example.

These are module build outputs, not complete deployment manifests: bindings,
assets, service peers and resource ownership configuration belong to the app.
No deployment occurs during a build.

## Verification and limitations

`//:sdk_archive_test` runs in the default test graph. It checks safe archive
members and normalized metadata, the complete header and adapter inventories,
source byte equality and adapter import closure. Removing an extracted dependency
must make bundling fail rather than falling back to this checkout.

`//:verify_package` is a separate Bazel run target because it starts fresh external
Bazel builds. It requires the absolute path to an official Bazel 9.3.0 executable
(or Bazelisk selecting that version). It:

1. Moves the archive to a path containing spaces, removing its original location.
2. Creates an unrelated consumer workspace with a checksum-pinned archive override.
3. Builds/runs a native consumer and all-header C++20/C++23 checks, then repeats
   with strict lockfile checking.
4. Builds a C++23 Worker with the archive's rule, without a project `.bazelrc`.
5. Bundles the extracted runtime with that consumer's generated module and executes
   its HTTP response in local workerd.
6. Removes temporary consumer, extraction and output directories in `finally`.

Dependency downloads may reuse Bazel caches. Native SDK/compiler installation
remains a host prerequisite. These checks exercise SDK integration, not live
Cloudflare behavior or complete C++23 standard-library conformance.
