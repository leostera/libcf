# KV storage

```sh
bazel build //:kv
bazel test //:kv_local_test
```

Use `cf::KvNamespace` for text/byte reads and writes, metadata, deletion, and cursor-based listing. Try `PUT/GET/DELETE /items/:key`, `PUT/GET /bytes/:key`, `/metadata/:key`, and `/list`. Optional `x-ttl` and JSON `x-metadata` headers demonstrate write options.

Values are limited to 1 MiB, result frames to 4 MiB, and options to 64 KiB. Empty values differ from missing keys. KV is eventually consistent, including cached misses; local immediate reads are not a production consistency guarantee. Stream/bulk reads and typed JSON decoding are not provided. The checked-in namespace is local-only.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
