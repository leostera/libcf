# Workflows client from C++

```sh
npm ci
node scripts/build-worker.mjs examples/workflow/wrangler.jsonc
node --test examples/workflow/test/*.test.mjs
```

Included in the default suite. This is a **client binding**, not a C++ WorkflowEntrypoint or durable step/replay implementation. The reference workflow is JavaScript, runs a native `step.do`, and optionally waits for an event.

`cf::Workflow(context.bindings, "FLOW")` supports:

- `create(id, params_json)` → `AsyncResult<Unit>`: a caller-selected instance ID and an owned JSON object payload. Success confirms creation, not execution completion. The provider must return the requested ID.
- `state(id)` → `AsyncResult<WorkflowState>`: Queued, Running, Paused, Errored, Terminated, Complete, Waiting, WaitingForPause, RollingBack or Unknown. A future/unrecognized state string is an explicit error, distinct from the native `unknown` state. Native `get(id).status()` is used; this subset exposes no output/error details to C++, though the native status call may materialize them in JS.
- `send_event_json(id, event_type, payload_json)` → `AsyncResult<Unit>`: await native `sendEvent({type, payload})`. Payload may be any bounded JSON value. Acknowledgement is not workflow completion or proof that a matching wait consumed the event.
- `erase(id)` → `AsyncResult<Unit>`: await native `get(id).delete()`. This deletes the instance and stored state, including an active instance; it is not a rollback of external side effects.

Instance IDs and event types are 1–100 ASCII letters/digits/underscores/hyphens and cannot start with a hyphen. JSON input is capped at 1 MiB, depth 32 and 65,536 value nodes. A shared bounded UTF-8/JSON parser is also used by Pipelines. Params must be an object; nested JSON is supported. Non-finite parse results reject before creation. Numeric precision and duplicate-key behavior follow JS JSON: use strings for exact decimals or large identifiers.

Four real local workerd cases verify C++ creation, lifecycle-state reads, JS reference-side parameter readback, duplicate-ID rejection, completed-instance deletion, active-instance deletion, event-driven completion with exact null/array payload readback and missing/invalid inputs. The event-waiting reference instance stays `running` in the pinned emulator; an attempted five-second observation did not reach `waiting`, so no local hibernation-transition claim is made. All ten state tags have separate JS/native codec tests. Missing-instance checks demonstrate API absence after deletion, not physical storage erasure or platform retention guarantees.

The diagnostic routes are `POST /create/<id>`, `GET /state/<id>`, `DELETE /delete/<id>`, `POST /event/<id>` (event type `continue`) and `POST /missing/<id>`. `/fixture-output?id=<id>` is JS-only test readback, not a C++ API. These routes provide **no production authorization** and must not be used to expose arbitrary instance management publicly.

The 2026-10-13 live probe reached creation/parameter readback, duplicate rejection, lifecycle reads and event-driven completion with exact payload readback. It then failed its immediate post-deletion absence assertion: the state endpoint returned HTTP 200 rather than the expected 502. That response body was not recorded, so no particular state or root cause is asserted. The full live probe remains unverified; instances, definition, Worker, DNS and certificate were cleaned up. See [dated evidence](../../docs/live-verification.md). Already-started creation/event delivery/deletion may finish after caller cancellation; ambiguous results are not automatically retried. There is no transaction or exactly-once side-effect promise.

Not implemented: generated IDs, retention settings, batch operations, pause/resume/restart/terminate, event subscriptions, C++ output/error retrieval, C++ workflow execution, steps, replay, sleep or rollback handlers.

## Opt-in live probe

Build the example, then run `node scripts/build-live-worker.mjs workflow`. Retain `build/live-workflow/test-deployment.json` and verify the generated Worker, exact hostname **and Workflow definition name** are unused. From `build/live-workflow`, dry-run and deploy with `cf deploy --prebuilt`. This creates a same-worker JS Workflow definition plus the C++ client, with workers.dev/previews disabled and no Cron schedule.

Run `LIBCF_LIVE_READY_TIMEOUT_MS=2400000 node scripts/test-live-workflow.mjs <host>` from the repository root. The probe records caller-selected instance IDs before mutation, checks parameter readback, event-driven completion, lifecycle state, duplicate rejection and completed/active deletion. Each state wait has a separate 45-second elapsed budget; readiness has the configured budget. It uses only small synthetic payloads and does not retry ambiguous creation/event delivery.

After success **or failure**, inspect instances only in the newly owned Workflow and delete any leftovers with `cf workflows instances delete <id> --workflow-name <workflowName> --force`. Verify the owned instance listing is empty before `cf workflows delete <workflowName> --force`, then delete the Worker. Workflow deletion does not delete its associated Worker. Verify the Workflow and Worker are absent, exact-host DNS is empty and its certificate (including wildcard SANs) has disappeared. The probe's best-effort instance finalizer does not replace this resource cleanup. A dry-run/deployment is not a live runtime pass.

Source retrieved 2026-10-13: [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) (updated 2026-10-12), pinned Worker types and Miniflare workflow implementation. This uses the Worker binding's deletion method, not an account-administration REST substitute.
