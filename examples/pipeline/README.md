# Pipelines JSON batches

```sh
bazel build //:pipeline
bazel test //:pipeline_local_test
```

`cf::Pipeline(runtime, binding).send_json(owned_json)` sends 1–1000 object records from a JSON array. Limits are 1 MiB UTF-8, 32 container levels, and 65,536 value nodes. Invalid syntax/types/non-finite values fail before dispatch. JavaScript number and duplicate-key semantics apply; use strings for exact large numbers.

`POST /send` awaits provider acceptance, not downstream transformation/sink completion. The pinned local send method is a no-op; tests establish dispatch/validation only. Stream schemas remain authoritative. No automatic retries, schema generation, management, or sink reads are provided. An ambiguous failure must not be blindly replayed.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
