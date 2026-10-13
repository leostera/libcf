# C++ Durable Objects: SQLite, transactions and alarms

```sh
npm ci
npm run test:durable
npm run build:durable
node scripts/dev-example.mjs durable
```

Both the frontend (`src/main.cpp`) and object (`src/object.cpp`) are C++. They compile to separate Wasm modules. The JS entrypoint exports `Counter = createDurableObject(objectFactory, objectWasm)`; the adapter creates a separate Wasm instance for each object and gates initialization with `blockConcurrencyWhile`.

`cf::DurableObjectNamespace(context.bindings, "COUNTERS").getByName(name)` returns a named HTTP stub. Method, URL, headers and binary body are forwarded separately; names are not interpolated into URLs or JSON. Empty names fail before host dispatch.

The object uses the same `cf::handle(Request, WorkerContext)` entrypoint, with `cf::durable_event(context.env)` yielding a typed Initialize, Fetch or Alarm event. These event markers and the storage capability are inserted by the adapter, not taken from request headers or paths; reserved-binding conflicts fail initialization. Initialization/alarm failures reject the platform event rather than falsely reporting success.

`cf::DurableStorage` provides:

- `sql(SqlCommand)`: parameterized queries returning shared `cf::SqlResult` rows and platform-specific metadata JSON.
- `transaction(vector<SqlCommand>)`: a single host `transactionSync`, including bounded result encoding. Any execution/encoding failure rolls it back.
- `setAlarm(system_clock::time_point)`: schedule the object's one alarm.

The SQL encoder consumes each cursor synchronously, within a 4 MiB result bound, before executing the next batch statement or yielding. **Separate `co_await sql()` calls are not an implicit transaction** and can interleave with other events. The counter increments using one `UPDATE ... RETURNING`; its alarm changes durable state only when armed, making duplicate delivery idempotent for this example. Single-statement response/transport failures do not prove a write failed: do not blindly retry mutations.

Routes: `POST /objects/:name/increment`, `GET /objects/:name/value`, `POST /objects/:name/echo`, `POST /objects/:name/sql-echo`, `POST /objects/:name/rollback`, `POST /objects/:name/schedule`, and `GET /objects/:name/alarm-count`. `/initializations` exposes a per-Wasm test counter, not durable state.

Seven local workerd tests cover private internal dispatch (not RPC-callable), per-object Wasm/SQLite isolation, concurrent atomic increments, binary/header/status forwarding, error paths, rollback, typed SQL blob parameters, C++ alarm effects and state recovery after stopping and recreating the whole runtime with the same temporary storage directory. Native tests cover precision, alarm-time rejection, event validation and wire decoding; JS tests bound lazy cursor/batch consumption.

**Live subset verified:** C++ initialization/isolation, concurrent atomic increments, SQL rollback and blobs, HTTP forwarding/errors and alarm effects. See [resource IDs and cleanup](../../docs/live-verification.md). Forced live eviction and alarm retries remain unverified. RPC, opaque/unique IDs, location hints, WebSockets/hibernation, async/sync KV storage, alarm get/delete and arbitrary transaction callbacks remain unimplemented. Bodies and parameters are buffered within the existing bridge limits; this is not end-to-end streaming or full Durable Object parity. Current local tests do not force alarm retries or prove exactly-once platform delivery.

Sources retrieved 2026-10-13: [namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [state/concurrency](https://developers.cloudflare.com/durable-objects/api/state/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
