# Cache API from C++

```sh
npm ci
npm run test:cache
npm run build:cache
node scripts/dev-example.mjs cache
```

`cf::Cache` exposes `match`, `put`, and `erase` for URL-keyed GET responses, using the default cache or a named cache. `cf::CachedResponse` preserves status, headers and binary bytes. This example uses `PUT/GET/DELETE /entries/:key`; `x-cache-name` selects a named cache. Responses are made cacheable with `Cache-Control: public, max-age=300`.

Three local tests cover binary bodies/headers, missing and empty values, actual deletion outcome and named-cache isolation. Native tests reject invalid response status and malformed wire results. The default suite is local workerd. Separate live probes verified default/named-cache miss/put/binary match/headers/delete, empty values and namespace isolation at one client/location; see [live evidence](../../docs/live-verification.md). Production cache topology, TTL expiry, geography, revalidation and eviction have not been verified.

The API currently buffers bodies within bridge limits (1 MiB operation payload and 4 MiB result). Streaming, request-method options, conditional matching and purge operations remain unimplemented. Cache writes do not replace durable storage.

Source: [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).
