# Synchronous wall clock from C++

```sh
npm ci
node scripts/build-worker.mjs examples/clock/wrangler.jsonc
node --test examples/clock/test/*.test.mjs
```

Included in the default local suite. `<cf/clock.hpp>` supplies `cf::WallClock`; `context.clock.now()` returns `Result<WallClock::TimePoint>` synchronously through the `libcf_host_now` f64 import. There is no binding-operation number, Promise completion or coroutine suspension for the clock read itself.

`TimePoint` is a `std::chrono::sys_time` with a signed 64-bit millisecond duration: Unix wall time, not a steady/monotonic clock. `.time_since_epoch().count()` gives signed Unix milliseconds. The boundary rejects non-finite, fractional or out-of-JavaScript-Date-range values before integer conversion (inclusive range ±8640000000000000 ms). Negative timestamps and backwards steps are valid. For native use/tests, construct `WallClock` with an owned `std::function<double()>` provider; an empty provider is rejected. Provider exceptions propagate; numeric validation failures return `HostFailure`.

**Workers' `Date.now()` reports the time of the last I/O and does not advance during code execution.** Do not use busy waiting, assume monotonicity, measure CPU time or infer precision from the millisecond representation. Use the separately bounded `Timer` for asynchronous sleeps. This API does not add calendar parsing/formatting, time zones, high-resolution profiling, a clock-sync guarantee or durable scheduling.

Two workerd cases verify a plausible Unix timestamp across the actual f64 import, unchanged samples during a synchronous turn, samples around awaited I/O and concurrent requests. Same-machine plausibility checks are not remote clock synchronization evidence, and samples around sleep do not assert precise elapsed time. Native tests cover range endpoints, invalid samples, backwards steps and missing providers; a JS host-import test checks fresh reads and preservation of values beyond i32. Live verification is pending; no clock endpoint has been deployed.

`WorkerContext` now includes an explicit `WallClock` member. Code that manually aggregate-constructs a context must supply that provider; normal Worker handlers receive it from the adapter.

Source retrieved 2026-10-13: [Workers web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/), especially JavaScript `Date.now()` and timers. Compatibility remains pinned to 2026-10-13.
