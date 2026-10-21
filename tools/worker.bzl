"""Declared Emscripten module builds; no source-tree compiler subprocesses."""

load("@bazel_lib//lib:copy_file.bzl", "copy_file")
load("@emsdk//emscripten_toolchain:wasm_rules.bzl", "wasm_cc_binary")
load("@rules_cc//cc:defs.bzl", "cc_binary")
load(":sdk.bzl", "WASM_COMPILE_OPTIONS")

_WORKER_EXPORTS = [
    "_libcf_http",
    "_libcf_fetch_done",
    "_libcf_cancel",
    "_libcf_stream_pull",
    "_libcf_stream_cancel",
    "_libcf_operation_done",
    "_libcf_operation_reply",
    "_libcf_digest_done",
    "_libcf_digest_scratch",
    "_libcf_request_head",
    "_libcf_request_body",
    "_malloc",
    "_free",
]

def _module(name, srcs, deps, host_library, exports, visibility, cxx_standard = 20):
    if cxx_standard not in [20, 23]:
        fail("libcf requires C++20 or C++23")
    cc_binary(
        name = name + "_link",
        srcs = srcs,
        deps = deps,
        additional_linker_inputs = [host_library],
        # Match em++'s existing default: allow throws, without catch/unwind support.
        copts = ["-std=c++%d" % cxx_standard] + WASM_COMPILE_OPTIONS,
        linkopts = [
            "-O2",
            "-sDISABLE_EXCEPTION_CATCHING=1",
            "-sMODULARIZE=1",
            "-sEXPORT_ES6=1",
            "-sENVIRONMENT=web",
            "-sWASM_ASYNC_COMPILATION=1",
            "-sALLOW_MEMORY_GROWTH=1",
            "-sFILESYSTEM=0",
            "-sEXPORTED_FUNCTIONS=" + ",".join(exports),
            "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
            "--js-library",
            "$(location %s)" % host_library,
        ],
        # Only the Wasm transition should request this target, not a host build.
        tags = ["manual"],
    )
    wasm_cc_binary(
        name = name + "_wasm",
        cc_target = ":" + name + "_link",
        outputs = ["wasm/%s.js" % name, "build/%s.wasm" % name],
        threads = "off",
    )
    copy_file(
        name = name + "_module",
        src = "wasm/%s.js" % name,
        out = "build/%s.mjs" % name,
    )
    native.filegroup(
        name = name,
        srcs = ["build/%s.mjs" % name, "build/%s.wasm" % name],
        visibility = visibility,
    )

def cf_worker(name, srcs, visibility = None, cxx_standard = 20):
    """Build a libcf Worker or DO module from application C++ sources."""
    _module(
        name = name,
        srcs = srcs,
        deps = [Label("//:worker_runtime")],
        host_library = Label("//:host_library"),
        exports = _WORKER_EXPORTS,
        visibility = visibility,
        cxx_standard = cxx_standard,
    )

def bridge_spike(name):
    """Build the original independent bridge fixture with its distinct ABI."""
    _module(
        name = name,
        srcs = [Label("//:examples/hello/src/spike.cpp")],
        deps = [],
        host_library = Label("//:examples/hello/src/host.js"),
        exports = [
            "_cf_add", "_cf_get", "_cf_fetch_asset", "_cf_resume",
            "_cf_background_write", "_cf_stream_chunk", "_malloc", "_free",
        ],
        visibility = None,
    )
