# Flagship boolean details

Typed `<cf/flagship.hpp>` client, operation480, through actual C++/Wasm. The
tests use both the **native local Flagship evaluator** and an **explicit fake
evaluator** for boundary/failure cases. Neither establishes live propagation or
account authorization.

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

The native fixture (`test/native.wrangler.jsonc`) explicitly declares
`remote: false` with a synthetic app ID. Its local-only wrapper seeds one owned
flag via Miniflare's private admin hook. C++ requests test STATIC/DISABLED results,
eight concurrent matching/nonmatching targeting keys (one equality rule), missing
flag and type-mismatch fallbacks, update/recovery, then deletion and fresh
FLAG_NOT_FOUND readback. This is local simulator evidence, not production
propagation, arbitrary targeting or rollout-hash parity.

Separate fake fixtures cover maxima, UTF-8/BOM/NUL output, absent/empty fields,
malformed results, cleanup failure and deadlines. The ordinary harness accepts
only explicit local Flagship fixtures with validated unique binding names and
app IDs; it refuses omitted/true remote settings and malformed declarations.
The production config is an unapproved app placeholder and remains refused.
Do not deploy this unauthenticated demonstration or its private fixture endpoints.
Live use needs owned app/flag/data, pricing, authentication and cleanup approval.
No flag administration API is exposed by libcf.

See [access-model audit](../../docs/flagship-artifacts-readiness.md).
