# Coroutine sleep

```sh
bazel build //:timer
bazel test //:timer_local_test
```

Included in the default suite. `cf::Timer(context.bindings).sleep(std::chrono::milliseconds)` returns `AsyncResult<Unit>` and uses Worker `setTimeout` inside the request context. It needs no resource binding. The SDK accepts 0–60,000 milliseconds; negative/excessive durations fail before dispatch. Four little-endian bytes carry the duration, and both boundaries check limits and completion shape.

A zero delay still schedules an asynchronous timer. This is not a precision clock, a real-time deadline, a CPU interruption mechanism or durable scheduling. Worker clocks advance with I/O, and timing can vary under load. Use Cron, DO alarms or Workflows for their respective durable scheduling semantics rather than retaining an HTTP request with sleep.

The timer observes the invocation-owned signal, rejects on cancellation and clears its handle/listener in `finally`, including when timer setup fails. Normal foreground completion also closes that signal. Late completion cannot resume a removed C++ invocation. This API is not registered as background `waitUntil` work.

Two workerd cases exercise zero/nonzero sleeps, 12 concurrent owned request URLs, invalid durations and subsequent recovery. These also exercise operation ID 256 across the Wasm ABI. Native tests check duration encoding, bounds and completion decoding. Controlled JS timer tests check asynchronous completion, maximum duration without waiting a minute, handle zero, pre-abort, pending abort/late callback and setup-failure cleanup. No wall-clock precision assertion or new live transport cancellation claim is made.

Opt-in live probe: build the example, run `bazel run //:prepare_live_worker -- timer`, establish ownership of the generated Worker/hostname, deploy with `cf deploy --prebuilt` from `build/live-timer`, then run `LIBCF_LIVE_READY_TIMEOUT_MS=2400000 bazel run //:live_timer -- <host>`. Verify Worker, DNS and certificate cleanup afterwards. No resource binding is needed. Live zero/nonzero waits, 12 concurrent owned URLs, invalid durations and recovery passed; Worker/DNS/certificate cleanup is verified. See [live evidence](../../docs/live-verification.md). No timer-precision or live transport-cancellation claim is made. Date/time access, repeating timers and per-operation cancellation handles remain outside this API.

Source retrieved 2026-10-13: [Workers web standards: timers and clocks](https://developers.cloudflare.com/workers/runtime-apis/web-standards/).
