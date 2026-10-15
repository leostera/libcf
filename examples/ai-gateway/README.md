# AI Gateway URL lookup

```sh
bazel build //:ai-gateway
bazel test //:ai-gateway_local_test
```

`cf::AiGateway::lookup_url(id, options)` calls `AI.gateway(id).getUrl(provider?)` and returns endpoint metadata. Native lookup makes a backend request; it is not local string construction or permission to fetch the result. The example never invokes inference or follows the returned URL.

IDs/providers are 1–64 lowercase ASCII alphanumeric/hyphen characters, starting alphanumeric. Timeout is 1–60000 ms. Results must match the canonical gateway.ai.cloudflare.com/v1 account/ID/provider form; omitted or universal provider selects the root URL. Validate account ownership and apply a separate destination/credential policy before any later fetch. POST an ID to `/url`. Creation, log access, inference, and credentials are not exposed.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
