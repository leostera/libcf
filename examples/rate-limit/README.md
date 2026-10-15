# Rate limiting

```sh
bazel build //:rate-limit
bazel test //:rate-limit_local_test
```

`cf::RateLimiter(runtime, binding).limit(key)` returns Allowed or Exceeded; provider/protocol failures remain errors. Keys are UTF-8 up to 64 KiB and may be empty. Prefer stable application/user identifiers over IP addresses. Try `POST /limit`; `/other` uses a separate namespace.

The platform limiter is approximate and location-scoped, not a globally strict quota. Matching namespace IDs share counters across bindings/Workers. Do not infer exact production counts from the local two-per-minute fixture, or deploy its namespace IDs unchanged.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
