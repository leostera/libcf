# Queues and scheduled handlers

```sh
bazel build //:events
bazel test //:events_local_test
```

`createEventWorker` routes fetch, Queue, and scheduled events to `cf::handle`. Use `cf::worker_event`, `queue_message`, and `scheduled_event` to parse trusted event metadata. Queue consumers must explicitly return `queue_ack()` or `queue_retry(delay)`; generic 2xx responses do not acknowledge delivery. Handler failures retry messages or reject scheduled events.

`cf::Queue::send_text` and `send_bytes` accept payloads smaller than 128,000 bytes and delay 0–86400 seconds. `send_text_batch` snapshots 1–100 NUL-free UTF-8 strings, each below 128,000 bytes, with a total frame cap of 256,000 bytes including count/length prefixes. Empty strings and BOMs are preserved. Batches use one shared delay and one provider call; no atomicity, ordering, or automatic retry is promised. Provider metadata may reduce usable limits. NUL text batches are rejected because the pinned local native producer truncates them; use single byte sends for binary data.

`POST /send/text`, `/send/bytes`, and `/lookup` demonstrate D1-backed consumption before acknowledgment. Message-ID deduplication does not make producer retries safe: a new enqueue can have a new ID. `/send/batch-text` accepts newline-separated messages only in the explicitly enabled local fixture; default `/send/batch*` routes return 403. That flag is not authentication. Consumer concurrency is capped at eight.

Scheduled tests invoke the local runtime directly; production Cron delivery is not established by them. Nonzero producer-delay timing is not verified. JSON/V8 payloads, byte/JSON/V8 batches, per-message batch delays, dead-letter management, batch disposition helpers, and scheduled noRetry controls are not exposed. Configure bounded retries/dead letters and protect all producer routes before deployment.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
