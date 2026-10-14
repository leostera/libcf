# AI Gateway URL lookup (explicit local mock)

```sh
bazel test //:ai-gateway_local_test
bazel build //:ai-gateway_bundle
```

The local configuration injects fake gateways into actual C++/Wasm. It does not
use a native AI binding, query the Gateway backend, fetch returned endpoints,
run inference or read logs. Ordinary harness runs reject the native `ai` declaration.
The production configuration is a guarded placeholder, **not deployment approval**.

```cpp
#include <cf/ai_gateway.hpp>
cf::AiGateway gateway(context.bindings, "AI");
cf::AiGatewayUrlOptions options;
options.provider = "openai";
auto result = co_await gateway.lookup_url("libcf-owned-gateway", options);
// result.value().url is owned endpoint metadata, NOT permission to fetch it.
```

`lookup_url()` calls `env.AI.gateway(id).getUrl(provider?)`. **Native getUrl makes a
backend GET**; it is not local URL construction. No beta/experimental option is
passed; the binding's ambient compatibility settings still apply. No inference,
log access, gateway creation/listing, retries or credential attachment is performed.
Returned URL shape does not prove gateway existence, account ownership, native
provider support, routing or authorization. No HTTP redirect or endpoint fetch
occurs in this example. `default` is allowed only as an explicitly selected ID,
not an inferred resource; URL lookup is not the inference auto-creation path.

- IDs and optional providers:1–64 lowercase ASCII alphanumeric/hyphen, first
  alphanumeric. Empty provider is invalid; absent provider omits the argument.
  Explicit `universal` is forwarded and expects the same root URL as omission.
- Timeout1–60000ms (default5000). Inputs validated before bounded snapshots;
  caller mutation after `lookup_url()` returns cannot change a pending operation.
- Result must exactly match
  `https://gateway.ai.cloudflare.com/v1/<account>/<id>/<provider>`, account1–128
  ASCII alphanumeric/hyphen, first alphanumeric, exact echoed ID/provider.
  Omitted/universal provider ends at the root trailing slash. Raw ASCII wire is
  41–295bytes. Both JS and C++ independently enforce this narrow canonical subset.
  No custom origin, port, credentials, encoded segments, query, fragment or URL
  normalization. Account segment syntax is not an owned-account check.
- Cleanup rejects successful projection but preserves primary errors. Deadline,
  abort and capability disposal do not prove backend work stopped or resources
  were deleted. Backend materialization happens before projection bounds.

`POST /url` body selects a synthetic gateway ID, default `libcf-owned-gateway`,
with provider openai. `/universal` omits the provider; `/explicit-universal` passes
it explicitly. `/provider-max` uses a64-byte fake provider for the295-byte boundary,
not a supported-provider claim. `/missing` and `/short-timeout` exercise failures.
Errors return generic502 without exposing backend diagnostics. Tests include8
concurrent IDs, exact maximum, malformed/cross-selector output, invalid inputs,
lookup/read failures, cleanup, both-stage deadlines and recovery.

Before native verification approve an owned account/gateway/provider, exact lookup,
access policy, data/logging and cost/cleanup plan. Inspect returned account and
apply a separate destination/credential policy before any later fetch. Do not
expose this unauthenticated ID-lookup example publicly as-is. Log read/mutation,
provider inference and broader Gateway APIs remain unimplemented.
See [scope/privacy readiness](../../docs/analytics-gateway-readiness.md).
