# Installed CMake package

libcf installs the header-only C++ target and its JS/Wasm host support files. No package publication is performed by these commands.

```sh
cmake -S . -B build/package -DBUILD_TESTING=OFF \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/install"
cmake --install build/package
```

Consumer `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.24)
project(my_worker LANGUAGES CXX)
find_package(cf 0.1 CONFIG REQUIRED)
add_executable(my_worker main.cpp)
target_link_libraries(my_worker PRIVATE cf::cf)
# Optional: use C++23 rather than the target's C++20 minimum.
set_target_properties(my_worker PROPERTIES CXX_STANDARD 23 CXX_STANDARD_REQUIRED YES)
```

Configure with `-DCMAKE_PREFIX_PATH=/path/to/install`. Include headers as `<cf/http.hpp>`, `<cf/subtle_crypto.hpp>`, etc.; there are no legacy namespace/package aliases.

## Runtime paths

`find_package` also exposes:

- `cf_RUNTIME_DIR`: installed adapter directory (normally `<prefix>/share/cf`). Contains `runtime.mjs`, event/DO adapters, binding helpers and `emscripten-host.js`.
- `cf_WORKER_SOURCE`: installed `src/worker.cpp`, used when compiling a Worker with Emscripten.

These are relocated paths, not references to the original source checkout or installation prefix. The install layout follows GNUInstallDirs: `CMAKE_INSTALL_INCLUDEDIR`, `CMAKE_INSTALL_DATADIR` and `CMAKE_INSTALL_LIBDIR`. The imported header target respects a customized include directory. If the package configuration is under a non-standard library directory, set `cf_DIR` directly to its installed `cmake/cf` directory.

The target itself supplies headers and the minimum language standard; it does **not** compile a Worker, generate a Wasm bundle, invoke Cloudflare deployment, or provide host implementations for a native executable. The repository's Emscripten examples demonstrate the current build flags and static Wasm import pattern. A native consumer can use portable pieces or supply host callbacks for asynchronous capabilities.

## Verification

The default suite includes `tests/installed-package.test.mjs`:

1. Install into a temporary prefix with spaces in its path and non-default include/data/library directories.
2. Move the entire prefix, removing the original location.
3. Configure an independent `find_package(cf)` consumer against the relocated package.
4. Compile all 29 current public headers together in explicit C++20 and C++23 modes, plus the core consumer, and execute all three CTest cases.
5. Verify exported include/runtime/source paths and the installed header/module inventory. Every source adapter must be present with identical contents.
6. Bundle all installed ESM adapters using esbuild, treating `cloudflare:*` as platform imports. Intentionally remove an installed dependency and verify resolution fails, proving there is no source-tree fallback.
7. Remove all temporary files in `finally`.

The header-inventory check fails when a new public header has not been added to the consumer. These are compilation, relocation and import-closure checks, not a live Worker deployment or a complete C++23 standard-library conformance test. Platform-only modules are not executed in Node. Existing Emscripten/workerd suites provide runtime checks separately.
