"""Hermetic equivalent of `worker-build --release` for the workers-rs comparator.

The pipeline mirrors worker-build 0.8.7 for the default (module) target:
Cargo default release profile (opt-level 3, no LTO) -> wasm-bindgen --target module with the reset-state
and abort-handler options -> wasm-opt -O with worker-build's explicit feature
set. The JavaScript shim lives beside the fixture source. worker-build's final
esbuild minification is not applied; every benchmark variant is bundled by the
same harness instead.
"""

def _wasm_transition_impl(settings, attr):
    return {
        "//command_line_option:platforms": "@rules_rust//rust/platform:wasm32",
        "//command_line_option:compilation_mode": "opt",
        # Read by the wasm-bindgen proc macro at expansion time, as worker-build sets it.
        "@rules_rust//rust/settings:extra_rustc_env": ["WASM_BINDGEN_USE_JS_SYS=1"],
    }

_wasm_transition = transition(
    implementation = _wasm_transition_impl,
    inputs = [],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:compilation_mode",
        "@rules_rust//rust/settings:extra_rustc_env",
    ],
)

_WASM_OPT_FEATURES = [
    "mutable-globals",
    "sign-ext",
    "nontrapping-float-to-int",
    "bulk-memory",
    "multivalue",
    "reference-types",
    "exception-handling",
    # Not in worker-build's list: the benchmark crate is compiled with simd128.
    "simd",
]

def _rust_worker_impl(ctx):
    library = ctx.files.library
    wasm = [f for f in library if f.extension == "wasm"]
    if len(wasm) != 1:
        fail("expected exactly one cdylib .wasm output, got %s" % library)
    # A tree artifact: wasm-bindgen also emits inline JS snippets under snippets/.
    out_dir = ctx.actions.declare_directory("build/%s" % ctx.label.name)
    bindgen = ctx.executable._wasm_bindgen
    wasm_opt = ctx.executable._wasm_opt
    opt_args = " ".join(["-O"] + ["--enable-" + feature for feature in _WASM_OPT_FEATURES] + ["--debuginfo"])
    ctx.actions.run_shell(
        inputs = wasm,
        tools = [bindgen, wasm_opt] + ctx.files._binaryen_runtime,
        outputs = [out_dir],
        mnemonic = "RustWorkerBuild",
        progress_message = "Running wasm-bindgen and wasm-opt for %{label}",
        command = """
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"{bindgen}" "{input}" --out-dir "$tmp" --no-typescript --target module --out-name index \
  --experimental-reset-state-function --force-enable-abort-handler
"{wasm_opt}" "$tmp/index_bg.wasm" -o "{out_dir}/index_bg.wasm" {opt_args}
sed 's/import source /import /' "$tmp/index.js" > "{out_dir}/index.js"
if [ -d "$tmp/snippets" ]; then cp -R "$tmp/snippets" "{out_dir}/snippets"; fi
""".format(
            bindgen = bindgen.path,
            input = wasm[0].path,
            wasm_opt = wasm_opt.path,
            out_dir = out_dir.path,
            opt_args = opt_args,
        ),
    )
    return [DefaultInfo(files = depset([out_dir]))]

rust_worker = rule(
    implementation = _rust_worker_impl,
    doc = "Builds a workers-rs cdylib into wasm-bindgen module output.",
    attrs = {
        "library": attr.label(mandatory = True, cfg = _wasm_transition),
        "_wasm_bindgen": attr.label(
            default = "//tools:wasm_bindgen",
            executable = True,
            cfg = "exec",
            allow_single_file = True,
        ),
        "_wasm_opt": attr.label(
            default = "//tools:wasm_opt",
            executable = True,
            cfg = "exec",
            allow_single_file = True,
        ),
        "_binaryen_runtime": attr.label(default = "//tools:binaryen_runtime", cfg = "exec"),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)
