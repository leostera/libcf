# Analytics SQL scalar query (explicit local mock)

```sh
bazel test //:analytics-sql_local_test
bazel build //:analytics-sql_bundle
```

The local configuration injects a fake engine into actual C++/Wasm. It never
queries account data. The ordinary harness rejects the native `analytics`
declaration, even with `remote:false`. Production configuration is a guarded
placeholder, **not deployment approval**. SQL uses an illustrative synthetic
schema; tests do not parse/execute it or establish platform dialect support.

`POST /query` uses named parameters; `/positional` demonstrates all scalar
parameter alternatives. Body is a synthetic label, default `synthetic-猫`.
No raw SQL comes from the HTTP caller. Output displays owned column names/values
and elapsed_ms/rows_read/bytes_read, including legitimate empty results. It is
not delimiter-safe interchange: strings/names may contain controls, BOM or NUL.
`/missing` and `/short-timeout` exercise errors; errors return generic502 without
publishing provider diagnostics. Fake fixture controls include empty/bad/unsafe/
too-many/throw/cleanup-fail/slow. Tests include8 concurrent labels,4096-byte text,
Unicode/control/quote escaping, negativezero, both parameter forms and recovery.

```cpp
#include <cf/analytics_sql.hpp>
cf::AnalyticsSql analytics(context.bindings, "ANALYTICS");
cf::AnalyticsSqlQuery query{
  "SELECT value FROM synthetic WHERE timestamp >= $start AND label = $label LIMIT 1",
  cf::AnalyticsSqlNamedParameters{
    {"start", std::string("2026-10-14T00:00:00Z")},
    {"label", std::string("owned-synthetic-label")}}};
auto result = co_await analytics.query(query, {.row_limit = 10});
```

The public value type distinguishes null/bool/double/string; parameters are
optional positional-vector or named-map. Absent parameters differ from empty
array/object. Use `double` for numeric parameters (for example1.0), not ambiguous
integer/bool conversion; large integers must be text. Results own rows of named
scalar columns and statistics (`chrono::duration<double,milli>`, two uint64
counters limited to JS-safe integers). Host results are strictly decoded,
including duplicate names, UTF-8, scalar tags, precision, lengths and trailing
bytes. No nested values/blobs/arbitrary SQL types are claimed.

Statement1–10240UTF8bytes; ≤100 parameters, named keys1–64ASCII identifiers,
text0–4096UTF8bytes; encoded parameter JSON≤65536bytes. Rows1–100 option (default100),
≤64 columns/row, names1–128UTF8bytes, aggregate wire28–1048576bytes. Timeout1–60000ms
(default5000). Inputs are validated before bounded snapshots, so mutation after
`query()` returns does not change a pending call. Zero returned rows is valid.

Limits cap **projection**, not native materialization, scan work, authorization
or billing. No SQL rewrite, native cancellation or automatic retry. Provider
failures become generic C++ host errors; provider retryable metadata is not
exposed through this ABI. Deadline/disposal does not prove a query stopped.

Before any native test: approve an owned account/dataset/schema, exact data/time
window and SQL, independent scan/cost/retention budget, application access policy,
credentials, logging and cleanup. Replace illustrative SQL with reviewed dialect
and dataset names. Parameterization/SELECT/LIMIT/account roles do not authorize
querying logs or customer data. Do not deploy this unauthenticated example as-is.
See [readiness and scope](../../docs/analytics-gateway-readiness.md).
