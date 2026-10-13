# Request cancellation boundaries

The `createWorker` adapter observes the signal on the Request it receives. It owns request bytes before C++ entry and keeps an invocation record until response completion or cancellation.

- Already-aborted requests return an adapter-level 408 without initializing Wasm or calling C++. Their unread body is cancelled best-effort.
- Cancellation during shared Wasm initialization is checked before C++ entry. Initialization itself is not interrupted; the adapter waits for it to settle, and another request may still use the resulting module.
- Input buffering observes the request signal. Aborting cancels a pending reader, releases its lock, and prevents partially buffered data from reaching C++. A rejected stream cancellation does not become an unhandled rejection.
- Foreground binding/Assets calls queued in a JS microtask recheck invocation ownership and the abort signal before dispatch. They cannot begin after the invocation was removed or cancelled.
- Assets fetches receive the signal; late response bodies are cancelled rather than buffered. Actual transport cancellation remains subject to the binding/runtime's behavior.
- An already-started storage, queue or other provider operation may finish, including side effects. Cancellation is **not rollback**, an atomicity guarantee, or a promise that remote work stopped.
- Late completions cannot resume a removed C++ invocation. Native weak-state/single-completion guards remain in place as a second ownership boundary.

Explicitly registered JS-hosted `waitUntil` work has its own platform-governed lifetime; it is not cancelled by the foreground dispatch gate. Response stream cancellation also has a separate stream lifecycle. Event adapters using synthetic requests do not thereby acquire an upstream client-abort signal.

`tests/runtime-abort.test.mjs` uses controlled module/provider doubles to prove these JS boundary rules: pre-abort, initialization success/failure after abort, stalled input cancellation, queued work suppression and next-request recovery, late operation completion, and late Assets body cancellation. These six tests are not new live transport evidence. Existing native and workerd suites continue to exercise the underlying runtime and stream paths.
