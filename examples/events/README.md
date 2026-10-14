# Queue and scheduled events from C++

```sh
bazel test //:events_local_test
bazel build //:events
bazel run //:events_dev
```

`createEventWorker(factory, wasm)` dispatches fetch, Queue and scheduled events to the same C++ `cf::handle`. `cf::worker_event(context.env)` selects the event; `queue_message()` and `scheduled_event()` parse platform metadata into owned typed values. Reserved metadata comes from the adapter, not HTTP headers or URL paths. Invocation state is isolated and Queue processing is bounded to eight concurrent messages per batch.

`cf::Queue::send_text` / `send_bytes` produce messages with optional `std::chrono::seconds` delay (0–86400). Raw UTF-8/binary bodies must be smaller than **128,000 bytes**, matching the platform's decimal-KB convention. This SDK guard is not a promise of near-limit provider acceptance: internal metadata also counts toward the platform limit. The consumer receives text or bytes plus message ID, queue name, attempt count and a millisecond timestamp. JSON/V8 structured payloads are not supported yet: they are retried, never silently acknowledged. Configure retry limits/dead-letter handling when adapting this example.

C++ consumers must return `queue_ack()` or `queue_retry(delay)` explicitly. A generic successful HTTP response is **not** an acknowledgement. Failures/missing dispositions retry; scheduled handler failures reject the platform event. `queue_retry` uses a 1–86400-second delay. Queue responses use SDK-reserved disposition headers internally; applications should use the helpers rather than constructing them manually.

The example awaits a D1 insert before acknowledging. Message ID is the primary key and `INSERT OR IGNORE` makes duplicate successful processing idempotent. `retry:` text is deliberately retried on its first attempt. Producers use `POST /send/text` and `/send/bytes`; `POST /lookup` returns a processed body with attempt/format headers. `GET /scheduled-status` reports the last scheduled metadata persisted by C++. Schema creation is idempotent and performed in the example; it is not a required SDK behavior.

Seven local tests exercise actual workerd Queue text/binary delivery, retry/redelivery before ack, a concurrent 16-message batch plus duplicate-ID replay, scheduled metadata, scheduled failure and oversized-producer rejection. Native tests reject malformed event metadata/delays; JS boundary tests check unsupported payloads and reserved-key conflicts. Scheduled tests invoke workerd's scheduled event directly, not a public HTTP simulation route. Live text/binary delivery, explicit retry/redelivery and oversized-producer rejection passed. The real Cron probe timed out without a scheduled write; scheduled handlers remain locally verified only. See [live evidence](../../docs/live-verification.md).

Not implemented: JSON/V8 payloads, sendBatch/results metrics, batch ack/retry helpers, dead-letter management, scheduled noRetry controls or exactly-once delivery. The current runtime rejects an ArrayBuffer for `contentType: 'bytes'` and requires an ArrayBufferView; the producer uses a copied Uint8Array. This was verified locally and live, not inferred from documentation (which currently describes ArrayBuffer).

The producer boundary was corrected from binary KiB to decimal KB on 2026-10-14. Native and JS tests cover 127,999-byte dispatch, 128,000-byte rejection, invalid delays/UTF-8, owned byte copies and provider failure without retries. Near-limit dispatch tests use mocks, not a live acceptance claim. Queue `sendBatch`, JSON/V8 payloads and queue metrics remain unimplemented; concurrent consumer-batch tests do not establish producer `sendBatch` support.

Producer text decoding preserves leading U+FEFF characters (including repeated ones).
A native C++ producer → Queue consumer → D1 readback test compares raw UTF-8 bytes:
`Response.text()` would itself remove a leading BOM. Both text and byte payloads
are snapshotted before reading the provider's `send` property, and the original
receiver is retained. JS regressions failed before these fixes.

A successful C++ send reply must be `Value` with no bytes; Missing, unknown kinds
and unexpected payloads now fail with HostFailure. This is a producer host reply,
not a consumer acknowledgment or delivery proof. A failed reply can occur after
the provider accepted a message, so libcf never automatically retries. Application
retries need a payload-level idempotency strategy: a newly enqueued message can
have a new Queue message ID, defeating deduplication by that ID alone.

The existing default send delay is explicitly zero, overriding a queue-level
default delay. Nonzero producer-delay delivery timing still needs native/live
evidence; bounds checks and retry/redelivery are not that proof.

Limit source retrieved 2026-10-14: [Queue limits](https://developers.cloudflare.com/queues/platform/limits/) (1 KB = 1,000 bytes; internal metadata counts toward message limits).

Sources retrieved 2026-10-13: [Queues JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).
