# Queue and scheduled events from C++

```sh
npm ci
npm run test:events
npm run build:events
node scripts/dev-example.mjs events
```

`createEventWorker(factory, wasm)` dispatches fetch, Queue and scheduled events to the same C++ `cf::handle`. `cf::worker_event(context.env)` selects the event; `queue_message()` and `scheduled_event()` parse platform metadata into owned typed values. Reserved metadata comes from the adapter, not HTTP headers or URL paths. Invocation state is isolated and Queue processing is bounded to eight concurrent messages per batch.

`cf::Queue::send_text` / `send_bytes` produce messages with optional `std::chrono::seconds` delay (0–86400). Bodies must be smaller than 128 KiB. The consumer receives text or bytes plus message ID, queue name, attempt count and a millisecond timestamp. JSON/V8 structured payloads are not supported yet: they are retried, never silently acknowledged. Configure retry limits/dead-letter handling when adapting this example.

C++ consumers must return `queue_ack()` or `queue_retry(delay)` explicitly. A generic successful HTTP response is **not** an acknowledgement. Failures/missing dispositions retry; scheduled handler failures reject the platform event. `queue_retry` uses a 1–86400-second delay. Queue responses use SDK-reserved disposition headers internally; applications should use the helpers rather than constructing them manually.

The example awaits a D1 insert before acknowledging. Message ID is the primary key and `INSERT OR IGNORE` makes duplicate successful processing idempotent. `retry:` text is deliberately retried on its first attempt. Producers use `POST /send/text` and `/send/bytes`; `POST /lookup` returns a processed body with attempt/format headers. `GET /scheduled-status` reports the last scheduled metadata persisted by C++. Schema creation is idempotent and performed in the example; it is not a required SDK behavior.

Six local tests exercise actual workerd Queue text/binary delivery, retry/redelivery before ack, a concurrent 16-message batch plus duplicate-ID replay, scheduled metadata, scheduled failure and oversized-producer rejection. Native tests reject malformed event metadata/delays; JS boundary tests check unsupported payloads and reserved-key conflicts. Scheduled tests invoke workerd's scheduled event directly, not a public HTTP simulation route. No live verification yet.

Not implemented: JSON/V8 payloads, sendBatch/results metrics, batch ack/retry helpers, dead-letter management, scheduled noRetry controls or exactly-once delivery. The current runtime rejects an ArrayBuffer for `contentType: 'bytes'` and requires an ArrayBufferView; the producer uses a copied Uint8Array. This was verified locally, not inferred from documentation (which currently describes ArrayBuffer).

Sources retrieved 2026-10-13: [Queues JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).
