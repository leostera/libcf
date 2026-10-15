# Examples

Run all commands from the repository root with official Bazel 9.3.0 or Bazelisk. Bazel supplies Emscripten and Node; install a host C++ compiler/SDK for native tests. Each example README lists its build and local test targets.

```sh
bazel test //:core_local_test
bazel run //:core_dev
```

Use the server's printed URL. For a new application, start with [core](core/README.md) and follow [SDK integration](../docs/packaging.md). `src/main.cpp` implements the handler; `worker.mjs` wires generated JS/Wasm to the shared runtime; `wrangler.jsonc` describes bindings. The filename does not require running Wrangler: repository deployment operations use cf CLI.

## Choose an example

| Use case              | Examples                                                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP and assets       | [Core](core/README.md), [outbound HTTP](http-client/README.md), [service bindings](service/README.md)                                                                                                                                                                                          |
| Storage               | [KV](kv/README.md), [D1](d1/README.md), [R2](r2/README.md), [Cache](cache/README.md)                                                                                                                                                                                                           |
| Stateful coordination | [Durable Objects](durable/README.md), [WebSockets](websocket/README.md)                                                                                                                                                                                                                        |
| Events                | [Queues and scheduling](events/README.md), [inbound email](email/README.md), [Workflow client](workflow/README.md)                                                                                                                                                                             |
| Utilities             | [Crypto](crypto/README.md), [clock](clock/README.md), [timer](timer/README.md), [metadata/secrets](metadata/README.md), [rate limiting](rate-limit/README.md)                                                                                                                                  |
| Service composition   | [JSON RPC](rpc/README.md), [service TCP](service-tcp/README.md), [Dynamic Workers](worker-loader/README.md), [dispatch](dispatch/README.md)                                                                                                                                                    |
| Images and content    | [Images](images/README.md), [Media](media/README.md), [Stream metadata](stream/README.md), [Legacy Sites](legacy-sites/README.md)                                                                                                                                                              |
| Data and AI           | [Analytics writes](analytics/README.md), [Pipelines](pipeline/README.md), [Analytics SQL](analytics-sql/README.md), [Workers AI](ai/README.md), [AI Gateway](ai-gateway/README.md), [AI Search](ai-search/README.md), [Vectorize](vectorize/README.md), [Agent Memory](agent-memory/README.md) |
| Specialized bindings  | [Browser screenshots](browser/README.md), [Container inspection](container/README.md), [Flagship](flagship/README.md), [Artifacts](artifacts/README.md), [mTLS/VPC HTTPS](outbound-https/README.md)                                                                                            |
| Contributor tools     | [Matched benchmark](../bench/README.md), [low-level bridge](hello/README.md)                                                                                                                                                                                                                   |

## Local tests versus real services

Default tests do not deploy or access an account. AI, Vectorize, dispatch namespaces, Media, Browser, Agent Memory, Container metadata, Artifacts, Analytics SQL, Gateway, AI Search, and mTLS/VPC use explicit provider mocks. These exercise the C++/Wasm integration, not native provider behavior. The pinned local Analytics Engine and Pipelines providers are no-ops, so successful sends do not establish persistence. Other local simulators also differ from production; see individual READMEs.

Example configs may contain local IDs, synthetic resources, or guarded placeholders. They are not deployable production templates. Diagnostic endpoints generally lack authorization; protect them before reuse. Human-readable tab-separated output is not a safe interchange format for arbitrary strings. SDK payload limits are not provider quotas, CPU limits, or billing bounds.

Builds produce modules/bundles, not a complete application deployment. Choose bindings, provision only resources you own, and supply credentials/configuration separately. Follow the [live testing rules](../CONTRIBUTING.md#optional-live-testing) for opt-in repository probes. Never deploy fixture names over existing resources.
