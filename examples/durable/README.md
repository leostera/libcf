# Durable Object namespace client from C++

```sh
npm ci
npm run test:durable
npm run build:durable
node scripts/dev-example.mjs durable
```

`cf::DurableObjectNamespace(context.bindings, "COUNTERS").getByName(name)` constructs a named stub; `stub.fetch(request)` forwards method, URL, headers and binary body and returns a buffered C++ `Response`. Empty names fail before host dispatch. Names cross a separate length-delimited field, never interpolated into JSON or a URL.

Routes: `POST /objects/:name/increment`, `GET /objects/:name/value`, `POST /objects/:name/echo`, and `POST /objects/:name/rollback`. Different names select different objects. The fixture increments with one SQLite `UPDATE ... RETURNING` statement, not a read/await/write sequence. Its rollback route executes two statements through `transactionSync` and verifies an error does not commit the first write.

**Scope:** the namespace client and frontend are C++; the `Counter` object is currently a **JavaScript platform fixture**, not a C++-authored Durable Object. C++ object lifecycle/storage/alarms are the next implementation slice. RPC, opaque/unique IDs, location hints, WebSocket upgrades and end-to-end streaming are not implemented. Body/header limits match the buffered service-binding bridge.

Four local workerd integration tests verify object isolation, concurrent atomic increments, binary/header/status forwarding, missing-binding/empty-name errors, SQL rollback and state recovery after stopping and recreating the whole runtime against the same temporary storage directory. Native tests cover wire operation identity and malformed replies. No live DO verification yet; do not infer C++ storage support from the JS fixture's persistence tests.

Sources retrieved 2026-10-13: [namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [state/concurrency](https://developers.cloudflare.com/durable-objects/api/state/). SQLite cursors must be consumed synchronously before awaiting; `transactionSync` callbacks must not return Promises. Those contracts constrain the upcoming C++ object adapter.
