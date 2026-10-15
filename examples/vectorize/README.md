# Vectorize query

```sh
bazel build //:vectorize
bazel test //:vectorize_local_test
```

`cf::Vectorize::query(VectorizeQuery)` accepts 1–1536 finite float32 values, top_k 1–100, and timeout 1–60000 ms. Dimensions must match the index. Results own IDs (up to 64 bytes) and finite scores without assuming a distance metric.

POST little-endian float32 values to `/query`; the mock expects three dimensions and does not implement nearest-neighbor ranking. Projection limits do not bound native parsing/allocation; deadlines do not guarantee stopped query usage. Namespaces, filters, metadata/values, queryById, describe, and mutations are not exposed. The index placeholder is not deployment-ready.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
