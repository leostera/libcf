# Analytics Engine writes

```sh
bazel build //:analytics
bazel test //:analytics_local_test
```

`cf::AnalyticsEngine(runtime, binding).write(point)` accepts an owned `AnalyticsDataPoint`: up to 20 blobs, 20 finite doubles, and one optional index. Blob bytes total at most 16 KiB; the index is at most 96 bytes. Blob/index values distinguish null, text, and binary. Column ordering belongs to your application schema.

`POST /write` submits a sample. Completion means binding acceptance, not persistence or query visibility. The pinned local provider's write method is a no-op, so local tests do not establish ingestion. No batch, retention, or delivery guarantees are exposed; querying is a separate [Analytics SQL API](../analytics-sql/README.md).

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
