# Worker-to-Worker service binding from C++

```sh
npm ci
npm run test:service
```

The test starts two real local Workers through Wrangler's local service registry. `cf::ServiceBinding(context.bindings, "UPSTREAM").fetch(request)` forwards a request to the configured binding and returns a C++ `Response`. Method, headers, binary body, response status and response headers cross a length-delimited ABI. HTTP errors such as 503 remain responses; missing bindings and transport failures become `Result` errors.

Four local tests cover POST/binary/header forwarding, upstream 503, bodyless 204 and missing binding rejection. Native tests reject malformed response wire data. Both request and response bodies are buffered within the bridge limits. The upstream fixture explicitly buffers its echo: directly returning its request stream triggered a body-already-used error in the local registry path, so this test does not claim streaming service parity.

For manual use, run `npm run build:service`, then start `npx wrangler dev --config examples/service/upstream/wrangler.jsonc --local --port 8788` and `npx wrangler dev --config examples/service/wrangler.jsonc --local --port 8787` in separate terminals.

Not yet covered: streaming, abort propagation to upstream I/O, RPC entrypoints, WebSocket upgrades, redirect policy and all fetch options. Live verification requires authentication and isolated deployed Workers; the default suite is strictly local.

Source: [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
