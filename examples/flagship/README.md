# Flagship boolean details

Typed `<cf/flagship.hpp>` client, operation480, through actual C++/Wasm. The
example currently uses an **explicit fake evaluator**, not a native binding.
Separate JS adapter tests exercise the pinned native local evaluator. Neither
establishes live propagation or account authorization.

```sh
bazel test //:flagship_local_test //:native_flagship_test
bazel build //:flagship //:flagship_bundle
```

`POST /evaluate` takes an optional UTF-8 targeting key in its body; an empty body
omits context. The flag is fixed to `libcf-owned-flag` and the required fallback
is explicitly `true`. The example returns the boolean and optional provider
fields as human-readable lines (not delimiter-safe interchange). An evaluated
`false` is not a failure; an `ERROR` reason can accompany a successful bridge
result containing a fallback. Transport/projection failures return502, never a
fabricated fallback. `/missing` and `/short-timeout` demonstrate failures.

```cpp
cf::Flagship flags(context.bindings, "FLAGS");
cf::FlagshipBooleanOptions options;
options.targeting_key = "synthetic-user";
auto result = co_await flags.boolean_details("libcf-owned-flag", true, options);
```

Key1–128 UTF-8 bytes; targeting key1–256 when present, no C0/C1 controls in either.
Timeout defaults5000ms, valid1–60000. Input validated before bounded owned copy.
Details own value plus optional variant≤256/reason≤64/error_code≤64/error_message≤4096
UTF-8 bytes. Empty differs from absent, unknown reason/code strings survive.
Returned BOM/NUL are opaque data. Wire20–4516 bytes; strict C++ decoder rejects
wrong kind/booleans/presence/UTF-8/length/truncation/trailing data. Timeout/disposal
does not establish stopped native work or stopped billing.

Local fake fixtures cover concurrency, maxima, UTF-8/BOM/NUL output, absent/empty
fields, provider fallback, malformed results, cleanup failure and recovery. The
production config is an unapproved app placeholder and is refused by the default
harness. Do not deploy this unauthenticated demonstration as-is. Native C++/Wasm
binding verification is the next step; live use needs owned app/flag/data, pricing,
authentication and cleanup approval. No flag administration API is exposed.

See [access-model audit](../../docs/flagship-artifacts-readiness.md).
