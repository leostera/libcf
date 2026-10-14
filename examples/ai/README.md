# Bounded Workers AI JSON calls

**Experimental subset; local provider is mocked. No real inference has been verified.**

```sh
bazel build //:ai //:ai_bundle
bazel test //:native_ai_test //:js_ai-adapter_test //:ai_local_test
```

`<cf/ai.hpp>` provides `cf::Ai` and named `AiRequest` fields:

```cpp
cf::Ai ai(context.bindings, "AI");
cf::AiRequest input{
    .model = "@cf/meta/llama-3.2-1b-instruct",
    .input_json = R"({"prompt":"Say hello.","max_tokens":16})",
};
auto result = co_await ai.run_json(std::move(input));
```

The result is owned UTF-8 JSON text, not a model-independent response structure.
Choose the model's documented input/output schema. The example's `/run` endpoint
accepts a JSON object for the fixed model above; `/` does not invoke inference.

## Boundary and lifetime

- Model names are 1–256 ASCII characters, starting with an alphanumeric or `@`,
  followed by alphanumerics or `_./:@-`.
- Inputs must be a JSON object, 1–1,048,576 bytes, at most32 container levels and
  65,536 nodes. `stream` must be absent or false. Numeric precision/duplicate keys
  follow JavaScript JSON; this is not a C++ JSON parser or model-schema validator.
- The adapter calls the native `AI.run(model, inputs, {returnRawResponse:true, signal})`.
  It checks HTTP success and JSON content type, then bounds body reads **before**
  parsing. The default binding JSON parser would run before libcf could cap it.
- Responses have the same byte/depth/node bounds. HTTP/provider failures propagate
  without retries. Response bodies are canceled on rejection, body overflow,
  cancellation or late completion; cleanup promises cannot delay the error.
- Cancellation does not prove inference rollback or reversal of usage charges.
  No request state or model result is shared between C++ invocations.

## What the tests prove

`test/local.mjs` explicitly injects an ordinary JS mock inside workerd; it does
not configure a native AI binding or remote proxy. Tests exercise real C++/Wasm
JSON dispatch, Unicode, concurrent ownership, invalid input, unsupported output,
provider failure and recovery. The local harness refuses the production AI config
rather than silently contacting an account. Native and JS tests additionally
check bounds, raw-response options, signal forwarding and stalled/late-body cleanup.
This is marked **M**, not native-binding/inference verification, in the operation ledger.

## Live gate and gaps

`wrangler.jsonc` describes the intended native binding and disables workers.dev
and preview URLs; it has no public route. No automated AI live deployment target
is enabled. Real inference requires an approved model/workload and account-usage
budget, plus an authenticated, bounded test ingress before exposing `/run`.
Never expose the generic JSON endpoint as an unauthenticated inference proxy.
The daily free allocation does not establish remaining quota on this account.

Streaming/SSE, binary responses, file/stream inputs, async batches, WebSockets,
model enumeration, gateway/options, tools/schema-specific helpers and usage/log
metadata APIs remain unsupported. A binary-output model may incur inference
usage before this JSON-only adapter rejects its result. No quality, latency,
model availability or live cancellation guarantee is inferred from mocks.

Sources checked2026-10-14: [binding API](https://developers.cloudflare.com/workers-ai/configuration/bindings/),
[selected model](https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/),
[pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[pinned workerd implementation](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/cloudflare/internal/ai-api.ts).
