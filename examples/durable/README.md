# Durable Objects with SQLite

```sh
bazel build //:durable
bazel test //:durable_local_test
```

The frontend and object are separate C++ modules. `worker.mjs` exports `Counter = createDurableObject(objectFactory, objectWasm)`, with one Wasm instance per object. `cf::DurableObjectNamespace(...).getByName(name)` creates a named HTTP stub. Inside the object, `cf::durable_event(context.env)` distinguishes Initialize, Fetch, and Alarm events.

`cf::DurableStorage` provides parameterized `sql`, a bounded `transaction(vector<SqlCommand>)` backed by `transactionSync`, and `setAlarm`. Separate awaited SQL calls are not a transaction and may interleave. Result frames are capped at 4 MiB. Unknown mutation outcomes must not be blindly retried.

Try `POST /objects/:name/increment`, `GET /objects/:name/value`, `/rollback`, `/schedule`, and `/alarm-count` under the same object prefix. Add authorization before exposing object names. RPC, opaque IDs, KV storage, arbitrary transaction callbacks, and alarm get/delete are not exposed. See the [WebSocket example](../websocket/README.md) for hibernatable callbacks.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
