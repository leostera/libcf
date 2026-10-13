# Worker-to-Worker service binding from C++

```sh
npm ci
npm run test:service
```

The test starts two real local Workers in one Miniflare/workerd runtime, using a native service binding. `cf::ServiceBinding(context.bindings, "UPSTREAM").fetch(request)` forwards a request to the configured binding and returns a C++ `Response`. Method, headers, binary body, response status and response headers cross a length-delimited ABI. HTTP errors such as 503 remain responses; missing bindings and transport failures become `Result` errors.

Five local tests cover POST/binary/header forwarding, upstream 503, bodyless 204, oversized-response rejection/recovery and missing binding rejection. Native tests reject malformed response wire data. Both request and response bodies are buffered within the bridge limits. The upstream fixture returns its request stream directly; the host bridge reads it into a bounded buffer. This passes with native local service bindings. It does not claim end-to-end streaming through the C++ API. The older cross-process registry fixture required upstream buffering; that workaround was removed after the Miniflare migration.

For manual use, run `npm run build:service`, then `node scripts/dev-example.mjs service`. Both Workers run locally in one workerd runtime.

Not yet covered: streaming, abort propagation to upstream I/O, RPC entrypoints, WebSocket upgrades, redirect policy and all fetch options. Live verification requires authentication and isolated deployed Workers; the default suite is strictly local.

Source: [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
