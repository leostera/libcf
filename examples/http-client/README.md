# Buffered outbound HTTP from C++

```sh
npm ci
node scripts/build-worker.mjs examples/http-client/wrangler.jsonc
node --test examples/http-client/test/*.test.mjs
```

Included in the default suite. Tests start an isolated loopback HTTP server and generate a temporary local configuration; no external origin or Cloudflare resource is contacted. For manual development, set `UPSTREAM_URL` to a controlled origin. The checked-in port 9 is a placeholder, not a required external service.

`cf::HttpClient(context.bindings).fetch(request, redirect)` returns `AsyncResult<cf::Response>` using platform global `fetch`, not a resource binding. It shares the Service Binding HTTP codec: owned request/response data, 1-MiB body and 64-KiB header bounds. URLs must be nonempty, at most 64 KiB, absolute HTTP(S), and contain no embedded username/password.

`cf::RedirectMode::Manual` is the default. `Follow` and `Error` require explicit selection. Manual returns the upstream redirect status and Location without following it. **Workers can forward all headers, including credentials, across hostnames when redirects are followed.** Only enable Follow for destinations/policies you trust. The SDK does not provide a destination allowlist or SSRF protection; applications must validate untrusted destinations. The fixture uses a configured origin and copies only its diagnostic `x-client` header, never incoming Cookie/Authorization/Host headers.

The incoming request signal is passed to native fetch and bounded response reading. Pre-aborted calls do not dispatch; late bodies are cancelled. This does not undo already-started upstream side effects. See [request lifetime](../../docs/request-lifetime.md).

Three workerd cases verify binary POST/status/selected headers, credential non-forwarding by the fixture, manual/follow/error redirects, empty 204 responses, network failures, response limits and recovery. Native tests check operation/redirect encoding and invalid inputs; JS tests check schemes/credentials/wire rejection before network dispatch and cancellation.

Live verification is pending after the documented DNS resolution blocker. No online endpoint was created for this feature. Worker-to-Worker public fetch may require the `global_fetch_strictly_public` compatibility setting; service bindings remain the preferred internal mechanism.

Not implemented here: streaming upload/download, WebSocket upgrades, per-operation abort handles/timeouts, `cf` fetch options, mTLS, private-network routing or a structured URL API. Use application-level policy rather than assuming redirects, credentials or destinations are safe by default.

Sources retrieved 2026-10-13: [Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/), [Request and redirect warnings](https://developers.cloudflare.com/workers/runtime-apis/request/).
