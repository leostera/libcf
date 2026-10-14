# Pipelines JSON batch producer

```sh
bazel build //:pipeline
bazel test //:pipeline_local_test
```

Included in the default suite. `cf::Pipeline(runtime, binding).send_json(owned_json)` returns `AsyncResult<Unit>`. This is explicitly a serialized-JSON boundary, not a C++ JSON DOM or schema generator. JS parses the owned UTF-8 input into records before invoking the native binding.

SDK limits: 1 MiB of UTF-8 JSON, 1–1,000 object records, container depth at most 32 and at most 65,536 value nodes. The string-aware depth guard runs before `JSON.parse`. Invalid UTF-8, syntax, root/record types and non-finite numeric results are rejected before provider invocation. Nested objects and arrays are supported. JSON semantics follow JavaScript, including IEEE-754 numeric precision and last-wins duplicate keys; use strings for identifiers or exact decimals that cannot safely be represented as JS numbers. Stream schemas and native limits remain authoritative.

On the real binding, current documentation says `send()` resolves when records are **confirmed as ingested**. The adapter awaits that promise and propagates rejection. This is not proof that a downstream pipeline transformation or sink has finished.

**Local limitation:** the pinned Miniflare `pipelines/pipeline.worker.js` implements `async send(_data) {}`. Its fulfillment does not demonstrate ingestion, schema enforcement or sink delivery. The two workerd cases verify dispatch, validation/errors and recovery only. Direct adapter tests verify parsed values, prototype-key safety, bounds, awaiting completion and provider errors; native tests verify request encoding and acknowledgement shape.

`POST /send` takes a JSON array of objects and returns `send completed; sink not verified`. `/missing` and `/oversized` exercise failures. No stream, pipeline, sink or live record was created for these tests. Live ingestion plus sink readback remains pending after DNS recovery; an HTTP 202 alone must not be counted as sink evidence.

Not implemented: C++ schema generation, transformation entrypoints, automatic retries/idempotency, HTTP ingestion endpoint management, pipeline administration, or sink reads through this class. Rejected/ambiguous sends are not automatically replayed because that could duplicate data.

Sources retrieved 2026-10-13: [writing to streams](https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/), [platform limits](https://developers.cloudflare.com/basin-pipelines/platform/limits/) (currently 5 MB per native ingestion request, larger than this SDK's input cap), pinned Worker types and Miniflare implementation. Current product documentation calls this Basin Pipelines; the Worker binding still exposes `send(records)`.
