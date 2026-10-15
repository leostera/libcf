# JSON service RPC

```sh
bazel build //:rpc
bazel test //:rpc_local_test
```

`cf::RpcService(context.bindings, "REFERENCE").call_json(method, arguments_json)` invokes a configured service and returns owned JSON text. Arguments must be an array of at most 32 values; input/output are capped at 1 MiB, 32 container levels, and 65,536 value nodes. Use strings for exact integers beyond JavaScript's safe range.

Method names are 1–100 ASCII letters/digits/underscores, starting with a letter; reserved/inherited names are rejected. Results accept ordinary JSON values, not capabilities, functions, streams, accessors, sparse arrays, or cycles. Pending and resolved RPC handles are disposed, including late results; disposal does not prove remote cancellation or rollback.

Try `/sum` or `POST /echo` with an argument array. Local tests start a JS reference service. These diagnostic routes have no production authorization. C++ RPC server exports, generated stubs, capability forwarding, and automatic retries are not provided.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
