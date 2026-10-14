# Bounded Vectorize query

`cf::Vectorize::query(VectorizeQuery)` sends1–1536 finite float32 values to the
GA/V2 binding and returns owned `VectorizeMatch { id, score }` records. `top_k`
is1–100; the local timeout is1–60000ms (default5000). Input dimensions must match
the configured index. Scores remain finite binary64 values without assuming a
particular distance metric. No retry is performed.

```cpp
cf::Vectorize index(context.bindings, "INDEX");
auto matches = co_await index.query({.values = {1.0f, 0.0f, 0.0f}, .top_k = 5});
```

```sh
bazel build //:vectorize_bundle
bazel test //:native_vectorize_test //:js_vectorize-adapter_test //:vectorize_local_test
```

The independently runnable local test uses `test/local.wrangler.jsonc` and an
**explicit JS mock**, not a local vector index. It exercises real C++/Wasm dispatch,
Unicode IDs, empty/concurrent results, invalid dimensions, malformed output,
provider errors, deadline and recovery. This is **M**, not native provider L/V.
Production `wrangler.jsonc` is a template: the local harness rejects it, its index
name is a placeholder, and it has no public routes or workers.dev/preview access.
Do not deploy it over an existing index or Worker.

The example accepts POST `/query` with little-endian float32 dimensions and
returns human-readable ID/tab/score lines. `/short-timeout` uses a20ms local budget;
GET `/` is health-only. The mock expects three dimensions, uses no network, and
is not intended to emulate nearest-neighbor ranking or eventual indexing.

## Limits and remaining work

The binding's own response parser runs **before** libcf sees the result; the SDK
caps its vector/reply wire payloads (at most6144 input and7604 result bytes), not the
provider's prior parsing/allocation. The native API has no public AbortSignal or
raw-response option. Local deadline/cancellation bounds waiting and discards late
results; it does not preempt synchronous parsing, stop provider usage or imply
remote rollback. Provider promises may settle later.

IDs are limited to64 encoded bytes. Only IDs/scores are exposed. Namespace
selection, filters, metadata/values, queryById, describe and mutations are not
implemented. Namespace selection would not itself establish tenant authorization.
Real index behavior, ranking and live query usage remain unverified. See the
[boundary audit](../../docs/vectorize-readiness.md) for source discrepancies and
the approval-dependent isolated live plan. No index or inference was used here.
