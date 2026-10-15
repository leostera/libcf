# R2 objects

```sh
bazel build //:r2
bazel test //:r2_local_test
```

`cf::R2Bucket` exposes `get`, `head`, `put`, `erase`, and `list`, with binary bodies and typed key/size/ETag/content-type metadata. Try `PUT/GET/HEAD/DELETE /objects/:key` and `/list`. The example's `x-offset` header requests a two-byte range; it is not standard HTTP Range handling.

Bodies are buffered up to 1 MiB; result frames are capped at 4 MiB. Deletion returns `Unit`, not proof the object existed. Multipart uploads, conditional operations, suffix ranges, custom metadata, checksums, SSE-C, storage classes, and streaming are not exposed. Use your own bucket configuration for deployment.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
