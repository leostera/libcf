# Policy-selected outbound HTTPS GET (mock)

```sh
bazel test //:outbound-https_local_test
bazel build //:outbound-https_bundle
```

`<cf/outbound_http.hpp>` provides distinct `MtlsHttp`, `VpcServiceHttp` and
`VpcNetworkHttp` clients. Each takes `(BindingRuntime, bindingName)` and exposes
`get_bytes(endpointName, BoundHttpsGetOptions{timeout}) -> AsyncResult<Bytes>`.
The endpoint name selects trusted deployment policy, never an incoming URL.
Only unredirected HTTP200 responses are supported, including empty bytes; all
other statuses and bodies over1MiB fail. No caller headers/body, redirects,
metadata forwarding or automatic retry. GET does not imply no side effects.

`createWorker(..., { outboundPolicy: trustedJsonText })` parses the policy once.
Missing policy/binding, wrong role, unknown endpoint and invalid input fail closed.
See [the exact policy and authority limits](../../docs/mtls-vpc-readiness.md).
Binding names are uppercase ASCII identifiers and endpoint names lowercase
letters/digits/hyphens, each1–64 bytes with a leading letter. Timeout1–60000ms.
Policy registration does not verify native binding kind, certificates, routes,
DNS ownership or verify_full. It constrains these dedicated GET operations, not
arbitrary application code or other fetch/binding APIs; it is not an egress sandbox. Never accept client-provided policies.

GET `/` is health. POST `/mtls`, `/vpc-service` or `/vpc-network` with a named
endpoint (default `health`) returns binary octet-stream/nosniff or generic502.
The explicit local fixture supplies fake providers and failure/boundary endpoints;
query diagnostic switches are test-only. Tests run actual C++/Wasm for all three
roles, but are **M** evidence, not native mTLS authentication/private routing.

The default policy uses reserved synthetic `.invalid` destinations. The native
configuration contains deliberately invalid, guarded approval placeholders:
**do not deploy it**. Native tests require an owned isolated origin/certificate/
network/connector, approved endpoints/data/roles/budgets, normal TLS verification,
`*.libcf.leostera.dev` test hosts and independent cleanup. No certificate reuse,
route scans, provisioning, external requests or account operations occur here.
Cancellation/disposal do not prove stopped upstream work, rollback or billing
limits. Raw TCP, plaintext HTTP, general fetch methods/headers/statuses and live
verification remain open. Cloudflare operations use cf CLI, never Wrangler.
