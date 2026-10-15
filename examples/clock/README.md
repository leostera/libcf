# Wall-clock time

```sh
bazel build //:clock
bazel test //:clock_local_test
```

`context.clock.now()` returns `Result<cf::WallClock::TimePoint>` synchronously. The time point is signed Unix milliseconds (`std::chrono::sys_time`), within the JavaScript Date range ±8640000000000000 ms. Negative timestamps and backwards steps are valid; malformed host values fail.

Workers' clock can stay fixed during synchronous execution and advance with I/O. Local workerd clock behavior differs. Do not use this as a monotonic clock, CPU timer, precision guarantee, or busy-wait primitive. Calendar parsing/time zones are not provided. Native callers can supply an owned clock function; manually constructed `WorkerContext` values must include it. Use [Timer](../timer/README.md) for coroutine sleep.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
