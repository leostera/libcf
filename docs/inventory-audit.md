# Inventory reconciliation — 2026-10-14

Baseline: `8c3e7d0`. This is a **gap audit, not release approval**. It reconciles
[INVENTORY.md](../INVENTORY.md), the [capability matrix](coverage.md), the
[operation ledger](binding-operations.md), public headers and example/test paths.
A matching row or existing file is not evidence that a test passed. Newly added
operations do not close an entire family. Historical live evidence is not a
current-revision Bazel rerun.

Clean CI38559816181 passed129 defaults,30 C++23/header and30 ASan/UBSan targets;
97-file relocated native20/23 and Worker23 consumers passed. Clean archive integrity:
`sha256-P90+1xcaqJ6gPODG6pnPrO/LYpfK3aWKxBYYkyS4ZHY=`. This verifies that revision's
implemented subsets, not the gaps below. No account operations were run for this audit.

## Foundation requirements

| ID | Existing evidence | Remaining gate |
| --- | --- | --- |
| F01 | [Bazel build](bazel.md), hello/core examples, [matched benchmarks](benchmarks.md) | Already checked in inventory; benchmark revisions are not the current release revision. |
| F02 | [Ownership contract](request-lifetime.md), [wire checks](wire-boundaries.md), native/JS boundaries and sanitizer CI | General JS-value escape hatch and generated adapter checks remain open; per-operation review is still required. |
| F03 | Coroutine bridge, owned requests, waitUntil, stream bytes/cancel in core/hello | End-to-end transport backpressure is unverified; buffered binding clients are not streaming clients. |
| F04 | HTTP/headers/router/env/result/context and event handlers | W05/W07 and broader stream/HTTP ergonomics remain partial. |
| F05 | Explicit numeric-operation ledger with enum/fixture consistency test | No generated comparison of all adapters to pinned TS declarations/config schema. |
| F06 | Bazel9.3.0-only builds, CI, packaging and relocated consumers | Generated type checks, formatting integration, explicit bundle/latency budgets and final-revision release checks remain open. |

## Capability-level gaps

“Historical” below means retained pre-Bazel live evidence, not a new pass. Local
classifications L/A/M and precise supported operations remain in the operation ledger.
Unimplemented is not synonymous with unavailable; account approval pending is not
a verified platform limitation.

| ID | Implementation/example anchor | Remaining implementation or verification work |
| --- | --- | --- |
| W01 | [core](../examples/core/README.md), [http.hpp](../include/cf/http.hpp) | CF request geo/bot/TLS metadata; final-revision HTTP rerun. |
| W02 | [core](../examples/core/README.md), [stream.hpp](../include/cf/stream.hpp) | Transport backpressure proof and complete inbound/outbound streaming binding paths. |
| W03 | [HTTP client](../examples/http-client/README.md), [cache](../examples/cache/README.md), [service](../examples/service/README.md) | Buffered subset only; historical live passes need Bazel reruns. |
| W04 | [WebSocket](../examples/websocket/README.md) | No general outbound client/pair API; Bazel live DO-mediated subset passed, not full WebSocket parity. |
| W05 | [router.hpp](../include/cf/router.hpp), [http.hpp](../include/cf/http.hpp) | Multipart/files, dedicated CORS/cookie/URL APIs and examples remain gaps. |
| W06 | [crypto](../examples/crypto/README.md), [timer](../examples/timer/README.md), [clock](../examples/clock/README.md) | Other crypto/calendar/repeating timers/log APIs; crypto/timer historical live reruns. Clock has Bazel live evidence. |
| W07 | [env.hpp](../include/cf/env.hpp), [core](../examples/core/README.md) | Owned string lookup only; typed JSON vars and broader type/error surface. |
| S01 | [KV](../examples/kv/README.md) | Existing CRUD/metadata/TTL acceptance/pagination subset needs Bazel live rerun; expiry/global consistency not proved. |
| S02 | [D1](../examples/d1/README.md) | Raw/session APIs and wider result metadata; existing subset needs Bazel live rerun. |
| S03 | [R2](../examples/r2/README.md), [r2.hpp](../include/cf/r2.hpp) | Multipart, conditions, checksums, richer metadata/ranges; existing buffered subset needs Bazel live rerun. |
| S04 | [DO](../examples/durable/README.md) | General IDs/stubs/connect/RPC surface beyond named buffered fetch; existing subset has Bazel live evidence. |
| S05 | [durable_storage.hpp](../include/cf/durable_storage.hpp), [DO](../examples/durable/README.md) | KV storage CRUD/list, broader transaction/cursor/sync/alarm APIs; SQL batches are not arbitrary async transactions. |
| S06 | [WebSocket](../examples/websocket/README.md), [DO](../examples/durable/README.md) | Tags/attachments; live reconstruction observed, not forced eviction or alarm-retry proof. |
| E01 | [events](../examples/events/README.md) | sendBatch/delay/dead-letter surface; revised raw-body rejection at128000 bytes needs live rerun. Earlier Queue delivery/retry pass does not verify the revised boundary. |
| E02 | [events](../examples/events/README.md) | No durable Cron write in45-minute JS/C++ control; need a new diagnostic hypothesis/readback, not unchanged redeployment. |
| E03 | [email](../examples/email/README.md) | Inbound reply and outbound send unimplemented; real routing requires approved owned sender/destination. |
| E04 | [rate limit](../examples/rate-limit/README.md) | Supported limit/key outcome subset has historical live evidence; Bazel rerun pending, no global quota claim. |
| D01 | [AI](../examples/ai/README.md) | JSON-only M subset; binary/streaming/advanced APIs and approved native usage remain open. |
| D02 | [analytics](../examples/analytics/README.md) | Local acceptance is a no-op, not persistence; live retention/deletion plan unresolved. |
| D03 | [networking audit](networking-readiness.md), [service TCP](../examples/service-tcp/README.md) | Service TCP has Bazel live evidence; general TCP/TLS/StartTLS/Hyperdrive unimplemented. UDP stub and public ingress limitations do not rule out other APIs. |
| D04 | [dispatch](../examples/dispatch/README.md) | Mock namespace is not WfP routing/isolation/CPU enforcement; entitlement/budget, props/capability surface remain open. |
| D05 | [Container audit](container-readiness.md) | Typed nullable C++ inspection and explicit-mock DO example only; lifecycle/ports unimplemented. Direct DO API/engine/pricing audited; default harness refuses declarations, native engine/process/account verification not attempted. |
| D06 | [metadata](../examples/metadata/README.md) | Version metadata historical live rerun; real secret read requires an approved owned store/secret, not existing data. |
| D07 | [RPC](../examples/rpc/README.md) | JSON client only; historical dirty-source live pass retained, clean Bazel rerun pending. No C++ RPC exports/general JS escape hatch. |
| P01 | [Workflow](../examples/workflow/README.md) | Client subset with JS reference; C++ steps/replay/retry/wait execution and wider lifecycle APIs unimplemented. Historical live retry passed; Bazel rerun pending. |
| P02 | [Pipeline](../examples/pipeline/README.md) | Local no-op acceptance only; approved ingestion and sink readback/retention plan required. DNS recovery alone is insufficient. |
| P03 | [Vectorize](../examples/vectorize/README.md) | IDs/scores-only M query; filters/metadata/namespaces/mutations/info and approved native index verification remain gaps. |
| P04 | [AI Search](../examples/ai-search/README.md), [Memory](../examples/agent-memory/README.md) | Keyword text query and get-or-create Memory listing are M; namespace/items/jobs/chat/vector retrieval and other Memory methods remain gaps, native data/access approval pending. |
| P05 | [Images](../examples/images/README.md) | Info only; binding transforms unimplemented. Recheck hosted upload/list/delete/direct-upload access model before classifying them as Worker binding APIs. Historical info live rerun pending. |
| P06 | [Stream](../examples/stream/README.md) | Bounded metadata L; upload/mutations/tokens/playback etc. remain gaps. Native resource/pricing approval required; simulator ingestion is not production format acceptance. |
| P07 | [Media](../examples/media/README.md), [Browser](../examples/browser/README.md) | First-frame PNG has narrow Bazel live evidence; other Media modes unimplemented. Browser screenshot is M; actions/sessions/native rendering remain open. |
| P08 | [Loader](../examples/worker-loader/README.md) | Restricted single-module fetch L; native creation-cost approval and broader loader capabilities remain open. |
| P09 | [access-model audit](flagship-artifacts-readiness.md) | Bounded C++ Flagship boolean details with native local Wasm evaluation/targeting/fallback/deletion readback; separate mock boundary/lifetime tests. Other evaluation/context methods remain open. Artifacts has bounded C++ metadata plus a mock Wasm example/RPC tests only; broader repository/file APIs and native verification remain open, with a remote-only native service in the pinned simulator. Owned data, pricing and native approval remain open. |
| P10 | [mTLS/VPC audit](mtls-vpc-readiness.md) | No dedicated API/example/native proof. Certificate identity, Service fixed routing versus Network broad reachability and remote-only simulator plugins audited; default harness refuses declarations. Owned certificate/origin/network, roles, TLS and budget approval required; TCP/TLS documentation drift remains unresolved. |
| P11 | [Analytics/Gateway audit](analytics-gateway-readiness.md) | Bounded C++ Analytics SQL scalar query/parameter/result/statistics subset with native codecs and an actual mock Wasm example; JS boundary/RPC lifetime tests. No native SQL or C++ retryability metadata proof; Gateway has bounded C++ canonical URL lookup with native codec and actual mock Wasm/RPC tests only; other Gateway methods and native verification remain open. Account-scoped Analytics SQL differs from Engine writes/legacy REST; Gateway getUrl also calls a backend, logs can contain private data and default inference may create a gateway. Native data/provider/cost approval required; pinned proxies have no local provider simulation. |
| P12 | [Sites scope audit](sites-readiness.md) | Optional track remains open: native local module manifest/KV reads and filters work through direct Miniflare; bounded JS owned-manifest/stream-read prototype passes native local tests, but no C++ API/example. PUT probe timed out; DELETE rejected. cf CLI deploy entrypoint supplies no automatic Sites sync callback; explicit KV/text-module deployment remains unverified. Modern Assets is not legacy manifest behavior. |
| X01 | [networking audit](networking-readiness.md) | C++ libc FS/sockets and C++ inbound handlers remain experimental/unproved. Service TCP from C++ to JS ingress does not prove these paths. |

## Every inventory track maps to audited capabilities

These labels match the inventory tables; duplicate capability references are
intentional where one API participates in several tracks.

| Track | Capability IDs |
| --- | --- |
| Events & runtime **R** | W01 W02 W06 E01 E02 E03 S04 S05 S06 |
| HTTP & web **R** | W01 W02 W03 W04 W05 |
| Env & identities **R** | W01 W03 W06 W07 D06 |
| Storage **R** | S01 S02 S03 W03 |
| Durable Objects **R** | S04 S05 S06 |
| Jobs & coordination **R** | E01 E02 E04 S05 |
| AI & analytics **R** | D01 D02 W06 |
| Network & services **R** | D03 D04 D05 D06 E03 |
| Developer ergonomics **R** | W05 W06 D07 |
| **P** Workflow binding and handler | P01 |
| **P** Pipelines | P02 |
| **P** Vectorize / AI Search / Agent Memory | P03 P04 |
| **P** Images / Stream / Media | P05 P06 P07 |
| **P** Browser rendering | P07 |
| **P** Flags / artifacts | P09 |
| **P** mTLS / VPC | P10 |
| **P** Workers Loader / RPC | P08 D07 |
| **P** other account bindings | P11 W03 D06 E03 |
| **X** Containers, inbound TCP to DO, Emscripten FS/sockets | D05 D03 X01 |
| **X** legacy Workers Sites | P12 |

## Next gates

1. Continue scoped implementation/access-model audits for unimplemented families,
   without converting a billing/data approval gap into “unavailable”.
2. Separate Queue-only boundary verification from the unresolved Cron experiment;
   do not repeat the unchanged45-minute control.
3. Rerun feasible historical live capabilities with isolated Bazel artifacts and
   independently verified cleanup. Record source/dirty state for each result.
4. Close foundation/type/backpressure/budget gaps, rerun benchmarks and clean
   packaging at the final release revision. No release or package publication yet.

`tests/inventory-audit.test.mjs` guards row/track completeness and local links only;
it cannot establish platform support, semantic parity or successful verification.
