# Policy-selected HTTPS GET

```sh
bazel build //:outbound-https
bazel test //:outbound-https_local_test
```

`cf::MtlsHttp`, `VpcServiceHttp`, and `VpcNetworkHttp` expose `get_bytes(endpointName, options)`. `createWorker(..., { outboundPolicy: trustedJsonText })` supplies trusted deployment policy; callers select names, not arbitrary URLs. Only unredirected HTTP 200 and bodies up to 1 MiB are accepted. Timeout is 1–60000 ms.

Binding names are uppercase identifiers and endpoint names lowercase letters/digits/hyphens, 1–64 bytes starting with a letter. Missing/wrong-role policy fails closed. Use `lib/outbound-policy.mjs` and `worker.mjs` for the policy schema. Policies constrain these operations, not arbitrary application code; they are not an egress sandbox or certificate/routing validation.

POST a named endpoint to `/mtls`, `/vpc-service`, or `/vpc-network`. Defaults use reserved .invalid destinations and invalid approval placeholders: do not deploy unchanged. No caller headers/body, redirects, retries, or general TCP are exposed. Native use needs owned certificates/networks/endpoints and explicit access/cost/cleanup plans.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
