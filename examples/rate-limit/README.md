# Rate-limit binding from C++

```sh
npm ci
node scripts/build-worker.mjs examples/rate-limit/wrangler.jsonc
node --test examples/rate-limit/test/*.test.mjs
```

Included in the default test suite. `cf::RateLimiter(runtime, binding).limit(key)` returns `AsyncResult<RateLimitOutcome>`: `Allowed` or `Exceeded`. Binding/protocol errors remain failures, not fabricated quota denials. Empty keys are valid; keys are bounded to 64 KiB of UTF-8 bytes. Prefer stable application/user keys rather than IP addresses. The example accepts a key in `POST /limit`; `/other` uses an independent namespace, and `/missing` demonstrates binding failure.

The local fixture configures two permits per 60-second period. Three workerd tests cover allowed/exceeded outcomes, key/namespace isolation, concurrent local calls, empty keys, oversized keys and recovery after binding errors. Native and JS tests reject malformed/truthy non-boolean host results.

Cloudflare's limiter is approximate and scoped to a location, not a globally strict transactional counter. Matching namespace IDs share counters across bindings/Workers. Local deterministic counts do not prove distributed semantics, fairness, billing accuracy or a global quota. Use fresh test namespace IDs for live deployment rather than the fixture's `1001`/`1002` values. Live allowed/exceeded outcomes, key/namespace isolation, error paths and later recovery passed at one client/location. Three calls were allowed before the first exceeded result with a configured limit of two, illustrating why the live probe does not assert exact counts. See [identities and cleanup](../../docs/live-verification.md).

Source retrieved 2026-10-13: [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
