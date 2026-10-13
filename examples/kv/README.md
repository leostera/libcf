# KV from C++

The application implements `cf::handle(Request, WorkerContext)` and uses `KvNamespace` coroutine operations. `src/worker.cpp` and the shared JS runtime own the ABI and request lifetime; the example has no hand-written storage JS.

```sh
npm ci
npm run test:kv
npm run build:kv
node scripts/dev-example.mjs kv
```

Requires the pinned Emscripten 6.0.12 toolchain. Routes:

- `PUT/GET/DELETE /items/:key`: text values, optional `x-ttl` and JSON `x-metadata` headers.
- `PUT/GET /bytes/:key`: binary values.
- `GET /metadata/:key`: value and metadata.
- `GET /list`: lists the `item:` prefix, following cursors with a one-key page size.

Five local integration tests cover empty vs missing values, binary round trips, metadata/TTL forwarding, cursor pagination and invalid input. Native tests exercise wire parsing. **Live subset verified:** empty/missing, binary values, metadata/TTL acceptance, prefix pagination, invalid metadata and delete, using bounded eventual-read retries. TTL expiry and geographic consistency remain unverified. See [live evidence and cleanup](../../docs/live-verification.md). The namespace ID in this config is local-only; provision a separate test namespace before deployment.

This is a bounded bridge: values are limited to 1 MiB, operation results to 4 MiB, and options to 64 KiB. These are library limits, not Cloudflare limits. KV stream reads, bulk reads, JSON decoding into domain types and complete cache-status metadata are not implemented. Absolute expiration and cache-TTL options are exposed but not yet integration-tested. Local immediate read-after-write behavior does not establish production consistency: KV is eventually consistent, including cached misses. Do not use these test sequences as a production consistency guarantee.

References: [KV read](https://developers.cloudflare.com/kv/api/read-key-value-pairs/), [write](https://developers.cloudflare.com/kv/api/write-key-value-pairs/), [list](https://developers.cloudflare.com/kv/api/list-keys/).
