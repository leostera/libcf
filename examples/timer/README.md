# Coroutine sleep

```sh
bazel build //:timer
bazel test //:timer_local_test
```

`cf::Timer(context.bindings).sleep(std::chrono::milliseconds)` returns `AsyncResult<Unit>`. Durations are 0–60000 ms; zero still schedules asynchronously. No resource binding is needed.

The timer observes request cancellation and clears its handle/listener on completion. It is not background `waitUntil` work, a precision clock, CPU interruption, or durable scheduling. Use Cron, Durable Object alarms, or Workflows when persistence is needed. Repeating timers and independent cancellation handles are not exposed.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
