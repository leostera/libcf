# Coroutine sleep

```sh
npm ci
node scripts/build-worker.mjs examples/timer/wrangler.jsonc
node --test examples/timer/test/*.test.mjs
```

Included in the default suite. `cf::Timer(context.bindings).sleep(std::chrono::milliseconds)` returns `AsyncResult<Unit>` and uses Worker `setTimeout` inside the request context. It needs no resource binding. The SDK accepts 0–60,000 milliseconds; negative/excessive durations fail before dispatch. Four little-endian bytes carry the duration, and both boundaries check limits and completion shape.

A zero delay still schedules an asynchronous timer. This is not a precision clock, a real-time deadline, a CPU interruption mechanism or durable scheduling. Worker clocks advance with I/O, and timing can vary under load. Use Cron, DO alarms or Workflows for their respective durable scheduling semantics rather than retaining an HTTP request with sleep.

The timer observes the invocation-owned signal, rejects on cancellation and clears its handle/listener in `finally`, including when timer setup fails. Normal foreground completion also closes that signal. Late completion cannot resume a removed C++ invocation. This API is not registered as background `waitUntil` work.

Two workerd cases exercise zero/nonzero sleeps, 12 concurrent owned request URLs, invalid durations and subsequent recovery. These also exercise operation ID 256 across the Wasm ABI. Native tests check duration encoding, bounds and completion decoding. Controlled JS timer tests check asynchronous completion, maximum duration without waiting a minute, handle zero, pre-abort, pending abort/late callback and setup-failure cleanup. No wall-clock precision assertion or new live transport cancellation claim is made.

Live verification remains pending after the documented DNS blocker; no resource or endpoint was created. Date/time access, repeating timers and per-operation cancellation handles remain outside this API.

Source retrieved 2026-10-13: [Workers web standards: timers and clocks](https://developers.cloudflare.com/workers/runtime-apis/web-standards/).
