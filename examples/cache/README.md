# Cache responses

```sh
bazel build //:cache
bazel test //:cache_local_test
```

`cf::Cache` supports `match`, `put`, and `erase` for URL-keyed GET responses in the default or a named cache. `cf::CachedResponse` owns status, headers, and binary bytes. Use `PUT/GET/DELETE /entries/:key`; `x-cache-name` selects a named cache.

Operation payloads are capped at 1 MiB and result frames at 4 MiB. Bodies are buffered. Streaming, conditional matching, request-method options, and purge operations are not provided. Cache writes are not durable storage or a guarantee of global visibility; local tests cannot establish production topology or eviction behavior.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
