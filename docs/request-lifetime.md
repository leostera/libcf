# Request cancellation boundaries

The `createWorker` adapter observes the signal on the Request it receives. It owns request bytes before C++ entry and keeps an invocation record until response completion or cancellation.

- Already-aborted requests return an adapter-level 408 without initializing Wasm or calling C++. Their unread body is cancelled best-effort.
- Cancellation during shared Wasm initialization is checked before C++ entry. Initialization itself is not interrupted; the adapter waits for it to settle, and another request may still use the resulting module.
- Input buffering observes the request signal. Aborting cancels a pending reader, releases its lock, and prevents partially buffered data from reaching C++. A rejected stream cancellation does not become an unhandled rejection. Oversized input/output bodies fail with the size-limit error and release the reader even when producer cancellation throws, rejects or never settles; cancellation remains best effort.
- Foreground binding/Assets calls queued in a JS microtask recheck invocation ownership and the abort signal before dispatch. They cannot begin after the invocation was removed or cancelled.
- Assets and outbound HTTP fetches receive an invocation-owned signal. Client abort forwards to it; normal completion and error cleanup also abort it, without changing the incoming Request's signal. Late response bodies are cancelled rather than buffered. Actual transport cancellation remains subject to the binding/runtime's behavior.
- JS invocation ownership is removed before final C++ cleanup. A C++ cleanup trap cannot retain the foreground signal/map entry on normal return; a trap during client cancellation rejects the invocation instead of escaping its abort listener.
- An already-started storage, queue or other provider operation may finish, including side effects. Cancellation is **not rollback**, an atomicity guarantee, or a promise that remote work stopped.
- Late completions cannot resume a removed C++ invocation. Native weak-state/single-completion guards remain in place as a second ownership boundary.
- If delivering a host result into C++ throws, its detached promise rejects the owning request before native cleanup. Cleanup runs in the request finalizer, so a second trap cannot leave the request pending or become an unhandled detached rejection. A cleanup error may supersede the original completion error.

Explicitly registered JS-hosted `waitUntil` work has its own platform-governed lifetime; it is not cancelled by the foreground dispatch gate. Response streams have a separate lifecycle: after headers, the incoming request
signal is handed off from the foreground invocation to the stream. An incoming
abort removes JS ownership, cancels the native source and errors the body with the
abort reason. EOF, explicit cancellation and failure detach that listener, so a
later abort cannot dispose the source again. Response-construction failure also
cleans up an already-created stream controller. On pull failure,
the JS controller entry is removed before native cleanup; a cleanup trap cannot
retain that entry or replace the primary pull error. Explicit stream cancellation
also removes the entry first, but reports a native cleanup failure to its caller.
Normal EOF removes the entry before closing the controller. These rules do not
prove that a trapped C++ module has recovered or released its native resources. Event adapters using synthetic requests do not thereby acquire an upstream client-abort signal.

`tests/runtime-abort.test.mjs` uses controlled module/provider doubles to prove these JS boundary rules: pre-abort, initialization success/failure after abort, stalled input cancellation, queued work suppression and next-request recovery, late operation completion, and late Assets body cancellation. Three further cases verify normal-completion cleanup, final C++ cleanup traps and cancellation-listener traps. Four additional cases cover binding/Assets completion traps with successful or failing native cleanup. These thirteen tests are not new live transport evidence. `tests/body.test.mjs` separately covers throwing/rejecting/non-settling oversize cancellation and exact-limit reads. Existing native and workerd suites continue to exercise the underlying runtime and stream paths.

`tests/runtime-stream.test.mjs` has ten same-isolate module-double cases: pull and
cancel with/without cleanup traps, EOF, demand, abort after headers with/without
cleanup traps, abort at handoff before the first pull, and failed response
construction. The trap regressions failed before the cleanup ordering fix. These
verify JS ownership and primary-error rules, not native trap recovery.

## Native C++23 stream probe

`bazel test //:stream_lifecycle_local_test` executes an emitted bundle built with
explicit `cxx_standard = 23`, a compile-time assertion and a runtime `__cplusplus`
readback of202302. The synthetic source owns a shared capture after the request
coroutine returns and emits at most128 chunks of65536 bytes (8MiB per stream).
No provider bindings, account resources or public sockets are used.

- Native same-request inspection verifies two distinct owned chunks, retention of
  the first chunk across subsequent C++ allocation/pulls, and destruction on
  explicit reader cancellation. Workerd did not match Node's exact prefetch timing;
  the probe checks delivered chunks and allows at most one queued chunk ahead.
- Owned loopback HTTP checks every byte across arbitrary transport chunk boundaries,
  finite-source EOF/destruction, and bounded pause/resume observations. Three
  repeated local runs sampled38→38,8→36 and8→34 produced chunks across a100ms
  pause, then received all8MiB. This variation is retained, not converted into a
  fixed buffering bound or throughput claim.
- A direct workerd socket with `enable_request_signal` observed the incoming
  client-abort event. Before the stream handoff fix, the native source was still
  active after the2s observation budget despite that event. After the fix, partial
  HTTP cancellation released the source within the test budget and next-request
  recovery passed. Additional chunks could be produced before the abort arrived;
  neither exact cancellation latency nor immediate stopped work is promised.
- The fixture distinguishes a source already at EOF from one active at client
  cancellation. Its counters and finite budget are test instrumentation, not a
  production streaming API or a generic memory bound. Miniflare is disposed and
  its owned temporary directory removed independently of the counters.

Incoming HTTP disconnect signals require platform support/configuration; see
[Request.signal](https://developers.cloudflare.com/workers/runtime-apis/request/)
and the explicit [enable_request_signal compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests).
A compatibility date alone is not the evidence for this opt-in. The initial
ordinary Miniflare-proxy fixture without the flag did not show native source
release within2s; that is a bounded observation, not proof cancellation never
occurs. The successful direct-socket/flag fixture is not proof of every proxy or
production transport. Apps must not assume disconnect cleanup without an effective
signal, explicit stream cancellation or finite source lifetime.

General transport buffering/CPU budgets and async streaming binding paths remain
open. `StreamSource::Next` is synchronous; its captures must own their lifetime,
and foreground binding operations cannot be kept alive merely by returning a
stream. A single queued chunk may itself be large.
