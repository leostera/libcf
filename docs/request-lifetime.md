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

Explicitly registered JS-hosted `waitUntil` work has its own platform-governed lifetime; it is not cancelled by the foreground dispatch gate. Response stream cancellation also has a separate stream lifecycle. On pull failure,
the JS controller entry is removed before native cleanup; a cleanup trap cannot
retain that entry or replace the primary pull error. Explicit stream cancellation
also removes the entry first, but reports a native cleanup failure to its caller.
Normal EOF removes the entry before closing the controller. These rules do not
prove that a trapped C++ module has recovered or released its native resources. Event adapters using synthetic requests do not thereby acquire an upstream client-abort signal.

`tests/runtime-abort.test.mjs` uses controlled module/provider doubles to prove these JS boundary rules: pre-abort, initialization success/failure after abort, stalled input cancellation, queued work suppression and next-request recovery, late operation completion, and late Assets body cancellation. Three further cases verify normal-completion cleanup, final C++ cleanup traps and cancellation-listener traps. Four additional cases cover binding/Assets completion traps with successful or failing native cleanup. These thirteen tests are not new live transport evidence. `tests/body.test.mjs` separately covers throwing/rejecting/non-settling oversize cancellation and exact-limit reads. Existing native and workerd suites continue to exercise the underlying runtime and stream paths.

`tests/runtime-stream.test.mjs` adds six same-isolate module-double cases: pull
failure and explicit cancellation with/without cleanup traps, normal EOF, and
single-chunk JS queue prefetch followed by demand. The trap regressions failed
before the cleanup ordering fix. They verify JS ownership and primary-error rules,
not native trap recovery, end-to-end HTTP/workerd backpressure or byte-bounded
transport buffering. A single queued chunk may itself be large. Transport
backpressure and producer memory/CPU budgets remain open.
