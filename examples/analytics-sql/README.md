# Analytics SQL queries

```sh
bazel build //:analytics-sql
bazel test //:analytics-sql_local_test
```

`cf::AnalyticsSql::query(AnalyticsSqlQuery, options)` accepts optional named or positional scalar parameters and returns owned scalar columns and statistics. Values distinguish null, bool, double, and string; use text for large integers. The example's `/query` uses fixed illustrative SQL, never raw SQL supplied by HTTP callers.

Statements are 1–10240 UTF-8 bytes; up to 100 parameters, text up to 4096 bytes, encoded parameters up to 64 KiB. Results allow 100 rows, 64 columns per row, and a 1 MiB frame. Timeout is 1–60000 ms. Limits bound projection, not scan work, materialization, authorization, or cost. Mock SQL is not a dialect compatibility claim. Nested values/blobs, SQL rewriting, retry metadata, and native cancellation are not exposed.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
