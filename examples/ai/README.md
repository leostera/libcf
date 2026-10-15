# Workers AI JSON

```sh
bazel build //:ai
bazel test //:ai_local_test
```

`cf::Ai::run_json(AiRequest{.model = ..., .input_json = ...})` returns owned JSON text. Choose the model's documented schema; the SDK does not validate model-specific semantics. POST a JSON object to `/run` for the fixture's fixed model.

Input/output caps are 1 MiB, depth 32, and 65,536 nodes. Input must be an object with stream absent or false; output must be successful JSON. Use strings for exact large numbers. Streaming/SSE, binary/file outputs, batches, model enumeration, and gateway options are not exposed. A non-JSON model can incur usage before output rejection. Never expose this endpoint as an unauthenticated inference proxy; cancellation does not reverse usage charges.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
