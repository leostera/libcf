"""Public SDK targets shared by this checkout and the distributable archive."""

load("@rules_cc//cc:defs.bzl", "cc_library")

WASM_COMPILE_OPTIONS = ["-O2", "-fexceptions", "-sDISABLE_EXCEPTION_CATCHING=1"]

def cf_sdk():
    """Expose headers, the C++ bridge, and its complete JS runtime closure."""
    cc_library(
        name = "cf",
        hdrs = native.glob(["include/cf/**/*.hpp"]),
        includes = ["include"],
        visibility = ["//visibility:public"],
    )
    cc_library(
        name = "worker_runtime",
        srcs = ["src/worker.cpp"],
        # A dependency does not inherit this project's .bazelrc.
        copts = ["-std=c++20"] + WASM_COMPILE_OPTIONS,
        deps = [":cf"],
        target_compatible_with = ["@platforms//cpu:wasm32"],
        visibility = ["//visibility:public"],
    )
    native.filegroup(
        name = "host_library",
        srcs = ["lib/emscripten-host.js"],
        visibility = ["//visibility:public"],
    )
    native.filegroup(
        name = "runtime_modules",
        srcs = native.glob(["lib/*.mjs", "lib/*.js"]),
        visibility = ["//visibility:public"],
    )
