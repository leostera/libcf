# Service binding HTTP

```sh
bazel build //:service
bazel test //:service_local_test
```

`cf::ServiceBinding(context.bindings, "UPSTREAM").fetch(request)` calls a configured Worker service. Methods, headers, binary bodies, statuses, and response headers cross the bridge separately. HTTP errors such as 503 remain responses; binding/transport failures are errors.

Requests fit a 1 MiB total wire frame; replies permit a 1 MiB body and 64 KiB header wire. This is buffered HTTP, not end-to-end streaming or native upgrade forwarding. `bazel run //:service_dev` starts both Workers locally. For JSON RPC, use the [RPC example](../rpc/README.md).

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
