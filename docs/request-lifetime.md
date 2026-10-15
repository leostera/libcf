# Request lifetime and cancellation

The `createWorker` adapter owns request bytes before C++ entry and tracks each invocation until response completion or cancellation. Coroutine inputs must own their data; borrowed ABI buffers are valid only during synchronous calls.

## Foreground operations

- Already-aborted requests return adapter-level 408 without entering C++; unread bodies are cancelled best effort.
- Cancellation during shared Wasm initialization is checked before C++ entry, but does not interrupt initialization needed by other requests.
- Input buffering observes the request signal, bounds bytes, and releases its reader on failure. Cleanup is not awaited indefinitely.
- Queued binding/Assets operations recheck invocation ownership before dispatch. Removed invocations cannot start queued work or resume from late results.
- Assets and outbound HTTP calls receive an invocation-owned signal. Client abort, normal foreground completion, and error cleanup close it. Late response bodies are cancelled rather than delivered.
- JS ownership is removed before final C++ cleanup. A native trap can still prevent native resource recovery; removing JS state is not recovery of a trapped Wasm module.

An already-started provider operation may finish and mutate state. **Cancellation is not rollback**, a delivery guarantee, or proof that remote work or billing stopped. Do not automatically retry an ambiguous write/send without an application idempotency strategy.

Explicit JS-hosted `waitUntil` work has its own platform-governed lifetime, separate from the foreground dispatch gate. Event adapters using synthetic requests do not acquire an upstream client-disconnect signal automatically.

## Response streams

After headers, the incoming signal is handed from the foreground invocation to the response stream. Abort removes JS ownership, cancels the native source, and errors the body with the abort reason. EOF, explicit cancellation, errors, and response-construction failure detach listeners and remove registry entries before cleanup. Later aborts cannot dispose the same source again.

Pull failures preserve the primary error if cleanup fails. Explicit cancellation reports cleanup failure. A native cleanup trap does not establish that captured C++ resources were released.

`StreamSource::Next` is synchronous. Stream captures must own their lifetime after the request coroutine returns; returning a stream does not keep foreground binding operations alive. Byte limits are not transport buffering, heap, CPU, or elapsed-time limits. A single chunk may itself be large, and empty chunks can consume time without exhausting a byte budget.

Incoming disconnect signals require effective platform support/configuration; see [Request.signal](https://developers.cloudflare.com/workers/runtime-apis/request/) and [enable_request_signal](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests). Do not assume every proxy propagates disconnects promptly. Use finite source lifetimes and explicit cancellation where appropriate.

## Contributor checks

`tests/runtime-abort.test.mjs`, `tests/runtime-stream.test.mjs`, and `tests/body.test.mjs` exercise ownership, cancellation, late results, and cleanup failures with controlled doubles. `bazel test //:stream_lifecycle_local_test` exercises an explicit C++23 emitted bundle with native source ownership, finite streaming, loopback HTTP, and direct-socket cancellation. These tests do not establish universal production backpressure or cancellation latency.
