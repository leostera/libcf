# Binding-operation verification

Snapshot: 2026-10-14. This ledger enumerates every numeric `cf::Operation` in the version-1 C++/JS binding protocol. It does **not** imply complete product coverage. The broader [capability ledger](coverage.md) also covers entrypoints, direct host imports, streams, event delivery and unimplemented APIs that are outside this enum.

`L` means a real local workerd fixture exercises the operation. `A` means workerd accepts dispatch but its pinned provider is a no-op: not persistence or ingestion evidence. `M` means the C++/Wasm bridge runs in workerd with an explicitly mocked provider, not the native binding or remote service. `V` means the named subset passed an isolated live probe; consult [dated deployment and cleanup evidence](live-verification.md). `Pending` and `Approval` are not passes or verified platform limitations. The Workflow retry verified deletion through independent instance-list readback; immediate binding lookups returned `terminated`, not absence. The earlier incomplete run is retained separately. Live results are single-client/location observations, not global consistency, exactly-once delivery or full production parity.

Every row below is implemented; its fixture links to local runtime tests. Native codecs and adapter boundary tests supplement those fixtures, but a row does not claim every possible failure or parameter combination is tested.

| ID | Operation | Local fixture | Local | Live | Verified subset or outstanding constraint |
| --- | --- | --- | --- | --- | --- |
| 1 | `KvGetText` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Missing, empty and text; bounded eventual reads. |
| 2 | `KvPut` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Text/binary, metadata and TTL acceptance; not TTL expiry. |
| 3 | `KvDelete` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Delete and eventual missing result. |
| 4 | `KvList` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Bounded prefix pagination; not a consistent global snapshot. |
| 5 | `KvGetBytes` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Binary roundtrip. |
| 6 | `KvGetMetadata` | [KV](../examples/kv/test/worker.test.mjs) | L | V | Value plus JSON metadata readback. |
| 16 | `D1Run` | [D1](../examples/d1/test/worker.test.mjs) | L | V | Bound mutations, binary CRUD and constraint failure. |
| 17 | `D1All` | [D1](../examples/d1/test/worker.test.mjs) | L | V | Typed row reads; bounded results. |
| 18 | `D1Exec` | [D1](../examples/d1/test/worker.test.mjs) | L | V | Schema/setup execution. |
| 19 | `D1First` | [D1](../examples/d1/test/worker.test.mjs) | L | V | First row/column, null and missing. |
| 20 | `D1Batch` | [D1](../examples/d1/test/worker.test.mjs) | L | V | Commit and rollback, including readback of attempted writes. |
| 32 | `R2Get` | [R2](../examples/r2/test/worker.test.mjs) | L | V | Binary, empty/missing and offset range; not multipart or conditional reads. |
| 33 | `R2Head` | [R2](../examples/r2/test/worker.test.mjs) | L | V | Metadata/ETag without object body. |
| 34 | `R2Put` | [R2](../examples/r2/test/worker.test.mjs) | L | V | Buffered binary/empty object and metadata. |
| 35 | `R2Delete` | [R2](../examples/r2/test/worker.test.mjs) | L | V | Object deletion and missing readback. |
| 36 | `R2List` | [R2](../examples/r2/test/worker.test.mjs) | L | V | Bounded prefix pagination. |
| 48 | `CacheMatch` | [Cache](../examples/cache/test/worker.test.mjs) | L | V | Default/named miss, binary/status/headers and isolation. |
| 49 | `CachePut` | [Cache](../examples/cache/test/worker.test.mjs) | L | V | Default/named buffered insertion; no global replication claim. |
| 50 | `CacheDelete` | [Cache](../examples/cache/test/worker.test.mjs) | L | V | Delete/empty results in default/named caches. |
| 64 | `ServiceFetch` | [Service](../examples/service/test/worker.test.mjs) | L | V | Buffered POST/binary/headers/status, errors and recovery; not arbitrary RPC. |
| 80 | `DurableSql` | [DO](../examples/durable/test/worker.test.mjs) | L | V | SQL reads/writes and blobs; no forced live restart. |
| 81 | `DurableSqlBatch` | [DO](../examples/durable/test/worker.test.mjs) | L | V | Atomic statement groups, racing increments and rollback. |
| 82 | `DurableSetAlarm` | [DO](../examples/durable/test/worker.test.mjs) | L | V | Alarm handler's durable effects observed; alarm retry is not verified. |
| 96 | `DurableFetch` | [DO](../examples/durable/test/worker.test.mjs) | L | V | Named-object buffered fetch, object isolation, binary/headers/errors. |
| 112 | `QueueSendText` | [Events](../examples/events/test/worker.test.mjs) | L | V | Consumer readback and explicit retry/redelivery; not exactly-once. |
| 113 | `QueueSendBytes` | [Events](../examples/events/test/worker.test.mjs) | L | V | Byte consumer readback and oversized rejection. |
| 128 | `RateLimit` | [Rate limit](../examples/rate-limit/test/worker.test.mjs) | L | V | Allowed/exceeded, key/namespace isolation, bounds and recovery; approximate/local. |
| 144 | `AnalyticsWriteDataPoint` | [Analytics](../examples/analytics/test/worker.test.mjs) | A | Approval | Bounded acceptance only; live retention/deletion terms need approval. |
| 160 | `VersionMetadataGet` | [Metadata](../examples/metadata/test/worker.test.mjs) | L | V | Version ID matches deployment; tag/timestamp and missing binding. |
| 176 | `SecretsStoreGet` | [Metadata](../examples/metadata/test/worker.test.mjs) | L | Approval | Uncached reads, local rotation/deletion and redacted failures; approved synthetic secret needed. |
| 192 | `WorkerLoaderFetch` | [Loader](../examples/worker-loader/test/worker.test.mjs) | L | Approval | Restricted single-module child, no HTTP/TCP egress; live creation fees need approval. |
| 208 | `CryptoDigest` | [Crypto](../examples/crypto/test/worker.test.mjs) | L | V | SHA-256/384/512 empty/binary/1-MiB input, concurrency and rejection/recovery. |
| 224 | `HttpFetch` | [HTTP](../examples/http-client/test/worker.test.mjs) | L | V | Live binary/status/headers, credential non-forwarding, manual/follow/error redirects, bounds/recovery, 204/503; connection-drop failure is local-only. |
| 240 | `PipelineSend` | [Pipelines](../examples/pipeline/test/worker.test.mjs) | A | Pending | Bounded JSON batch dispatch; live ingestion acknowledgement plus sink readback still needed. |
| 256 | `Sleep` | [Timer](../examples/timer/test/worker.test.mjs) | L | V | Zero/nonzero waits, 12 concurrent owned URLs, invalid durations and recovery; no precision guarantee. |
| 272 | `WorkflowCreate` | [Workflows](../examples/workflow/test/worker.test.mjs) | L | V | Owned JSON params, JS reference-side readback and duplicate-ID rejection. |
| 273 | `WorkflowStateGet` | [Workflows](../examples/workflow/test/worker.test.mjs) | L | V | Running-or-waiting/complete reads; post-delete terminated observed live, while missing-after-delete is local-only. Ten tags have codec tests, not ten observed transitions. |
| 274 | `WorkflowDelete` | [Workflows](../examples/workflow/test/worker.test.mjs) | L | V | Completed/active deletion acknowledged; independent instance list empty before administrative cleanup. Not physical erasure or rollback. |
| 275 | `WorkflowSendEvent` | [Workflows](../examples/workflow/test/worker.test.mjs) | L | V | Null/array payload readback and JS workflow completion; no C++ durable replay. |
| 288 | `ImageInfoGet` | [Images](../examples/images/test/worker.test.mjs) | L | V | PNG dimensions/size, SVG category, invalid/empty/missing/oversized failures and recovery; no transforms/uploads. |
| 304 | `RpcCallJson` | [JSON service RPC](../examples/rpc/test/worker.test.mjs) | L | Pending | Owned bounded JSON arguments/results, concurrent calls, errors and recovery. Separate JS workerd tests verify rejected/late capability disposal; no C++ RPC exports. |
| 320 | `AiRunJson` | [AI JSON](../examples/ai/test/worker.test.mjs) | M | Approval | Bounded JSON object input and raw JSON response, errors, owned concurrent dispatch. No real inference; account usage needs approval. Streaming/binary/advanced options remain gaps. |
| 336 | `ServiceTcpExchange` | [Service TCP](../examples/service-tcp/test/worker.test.mjs) | L | V | Empty/binary/1MiB and concurrent bounded half-close/EOF exchanges, invalid address, overflow, deadline and recovery passed in an isolated Bazel live pair; cleaned. No persistent sockets, socket TLS, C++ ingress or general outbound TCP. |
| 352 | `VectorizeQuery` | [Vectorize query](../examples/vectorize/test/worker.test.mjs) | M | Approval | Finite float32 input, bounded owned IDs/binary64 scores, empty/concurrent/error/deadline recovery via explicit mock. Native pre-parsing remains outside SDK caps; no provider cancellation/ranking/mutation claim. |
| 368 | `DispatchFetch` | [Dynamic dispatch](../examples/dispatch/test/worker.test.mjs) | M | Approval | Buffered HTTP via mock namespace and native local service Fetcher; binary/header/status forwarding, bounds, manual redirects, cancellation and recovery. No WfP routing/limit-enforcement/isolation or props claim. |
| 384 | `MediaFramePng` | [Media frame](../examples/media/test/worker.test.mjs) | M | V | Local mock covers ownership, bounds, single-use chain, deadline/cancellation and recovery. Live synthetic-GIF request returned PNG MIME/signature and128x128 IHDR; auth, invalid cases, recovery and cleanup passed. No full PNG decode, pixel, MP4, other-mode or live cancellation claim. |
| 400 | `AiSearchKeywordQuery` | [AI Search keyword query](../examples/ai-search/test/worker.test.mjs) | M | Approval | Bounded UTF-8 query, owned text chunks/IDs/source keys/binary64 scores, explicit keyword options, concurrent/error/deadline recovery via mock. Separate native RPC ownership fixture; no native AI Search ranking/indexing/usage or cancellation proof. |
| 416 | `StreamVideoList` | [Stream metadata](../examples/stream/test/worker.test.mjs) | L | Approval | Bounded first-page metadata via real local simulator and C++/Wasm; empty/populated/deleted reads. Unit mocks cover malformed/bounded results and scope deadlines. Account-scoped, not tenant authorization or complete inventory; no upload/transcoding/playback proof. |
| 417 | `StreamVideoDetails` | [Stream metadata](../examples/stream/test/worker.test.mjs) | L | Approval | Owned metadata, ID equality, concurrent local simulator reads and missing-record failure. Explicit mock covers invalid output, deadline and recovery; late scope disposal does not delete videos or prove native cancellation. |

## Scope not represented by binding-operation numbers

- HTTP entry/response, environment variables, RNG/UUID and the streaming C ABI have separate tests and live records. The synchronous `libcf_host_now` f64 import is outside this enum: [wall-clock example](../examples/clock/README.md), native and host tests plus two workerd cases; corrected live probe verified f64 samples, same-turn reads, post-I/O sampling, JS brackets and concurrency, followed by cleanup. No clock precision or monotonicity guarantee. RNG smoke is not an entropy audit. Stream bytes/client cancellation are not a verified transport-backpressure claim.
- DO initialization, alarm callbacks and hibernating WebSocket events have local/live evidence in the capability ledger; object tags/attachments and arbitrary RPC remain gaps.
- Queue consumer dispositions have delivery/retry evidence. Real Cron remains unresolved after both C++ and plain-JS controls failed to produce a scheduled write within their bounded windows.
- Inbound email is locally tested only; real sender/destination approval is still needed. Outbound email is not implemented.
- AI has only the bounded JSON subset above; real inference, streaming/binary output and advanced options remain gaps. Hyperdrive/networking, dispatch, broader storage/crypto, media transforms, search and the other planned inventory rows are **not** made complete by this table.

`tests/operation-ledger.test.mjs` checks that the table has exactly one row for every enum name/number, no invented or duplicated operations, and existing fixture links. It does not infer test success from source text or automatically promote live status. Evidence and subset notes require review when behavior changes.
