# Analytics Engine from C++

```sh
bazel build //:analytics
bazel test //:analytics_local_test
```

Included in the default test suite. `cf::AnalyticsEngine(runtime, binding).write(point)` returns `AsyncResult<Unit>` after the native binding accepts a data point. **This is not a persistence or query-visibility receipt:** native `writeDataPoint()` returns synchronously and the platform performs ingestion in the background.

`AnalyticsDataPoint` owns ordered blob and double vectors and an optional single index. Blobs/indexes distinguish null, UTF-8 text and binary bytes. Both bridge sides enforce up to 20 blobs, 20 finite doubles, 16 KiB aggregate blob bytes and a 96-byte index. The optional single-index type prevents constructing multiple indexes in C++. IEEE-754 values use explicit little-endian encoding, preserving negative zero. Column positions are part of your application schema; keep them consistent across writes. The platform also limits writes to 250 data points per invocation.

`POST /write` accepts an index and submits a sample point; `/missing` exercises binding errors. The response says `accepted; not a persistence receipt`.

**Local limitation:** the pinned Miniflare Analytics Engine implementation's `writeDataPoint` is an empty method (`dist/src/workers/analytics-engine/analytics-engine.worker.js`). The two workerd cases verify dispatch/acceptance, input rejection and error recovery only. Native tests and direct JS tests share a golden wire encoding to verify values, types, ordering and malformed-data rejection. There is no local persistence or query claim.

**Live not attempted:** current documentation retains Analytics Engine data for three months. CLI discovery found the SQL query command but no dataset deletion command. No dataset or live point was created without a verified cleanup path or explicit retention approval. A future live probe must query the isolated dataset through `cf analytics_engine sql query` to prove visibility, rather than treating HTTP 202 as storage evidence.

Not implemented: batch writes, SQL queries as a Worker binding, retention configuration or delivery guarantees. Analytics SQL is a separate inventory capability.

Sources retrieved 2026-10-13: [getting started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/), [limits and retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/), project-pinned Miniflare implementation and Worker types.
