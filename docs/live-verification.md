# Live verification

## Rules

Use the authenticated **cf CLI**, not Wrangler. All online test endpoints must be under **`*.libcf.leostera.dev`**, with `workersDev: false` and `previewUrls: false`. Do not bypass TLS verification. Deployment/resource mutations are opt-in and must not enter the default local test suite. Keep resource names isolated, check for collisions, and remove test deployments and domain/DNS attachments afterward.

Current CLI baseline: `cf` **1.0.0-beta.6**. The prebuilt deployment adapter uses Cloudflare Build Output Specification **v0**, which is experimental and may change. It avoids depending on a Wrangler build/deploy command. Local tests and the benchmark launch Miniflare/workerd directly; CI deployment dry-runs use cf. Historical example config filenames remain `wrangler.jsonc`, but no Wrangler subprocess is needed by these test paths.

## Cache deployment probe

```sh
npm run build:cache
node scripts/build-live-worker.mjs cache
cd build/live-cache
cf deploy --prebuilt --dry-run
# Inspect test-deployment.json; verify its random name/domain are unused.
cf deploy --prebuilt
# From the repository root:
node scripts/test-live-cache.mjs <generated-hostname>
# Always clean up, even when the probe fails:
cf workers delete <generated-worker-name> --force
cf dns records list --zone leostera.dev --name <generated-hostname>
cf workers get <generated-worker-name> # should report not found
```

The builder only emits artifacts; it neither deploys nor creates resources. Do not regenerate artifacts while a previous deployment still needs cleanup: retain its identity from `test-deployment.json`. The probe checks a single client/location, not global cache consistency, TTL or eviction. Readiness defaults to a fifteen-minute elapsed budget covering HTTPS requests, response bodies and retry sleeps. For an explicitly longer DNS/certificate wait, set `LIBCF_LIVE_READY_TIMEOUT_MS=2400000` (40 minutes); values must be positive integer milliseconds, capped at 2700000 (45 minutes). Individual requests still have a ten-second cap, caller cancellation is preserved, redirects are rejected and paths cannot escape the isolated HTTPS origin. These budgets are not promises of provisioning time. Keep the same owned hostname through the wait and verify cleanup afterwards.

## D1 deployment probe

Create a uniquely named `libcf-d1-...` database with `cf d1 create --name <name>` and retain the returned UUID for cleanup. Never bind an existing application database. Then:

```sh
npm run build:d1
node scripts/build-live-worker.mjs d1 <isolated-database-uuid>
cd build/live-d1
cf deploy --prebuilt --dry-run
# Inspect test-deployment.json and check for a hostname collision first.
cf deploy --prebuilt
# From the repository root:
node scripts/test-live-d1.mjs <generated-hostname>
# Always clean up and verify absence:
cf workers delete <generated-worker-name> --force
cf d1 delete <isolated-database-uuid> --force
cf workers get <generated-worker-name>
cf d1 get <isolated-database-uuid>
cf dns records list --zone leostera.dev --name <generated-hostname>
```

The probe covers setup/exec, binary CRUD, first/null/missing, transactional batch commit/rollback and constraint errors. Default local tests exercise hostname guards without any network calls. The live probe is never invoked by `npm test`.

## KV and R2 deployment probes

Create isolated resources with `cf kv namespaces create --title libcf-kv-<random-suffix>` and `cf r2 buckets create --name libcf-r2-<10-hex-digits>`. Retain their returned ID/name for cleanup. Build with `npm run build:kv` / `npm run build:r2`, followed by `node scripts/build-live-worker.mjs kv <namespace-id>` / `node scripts/build-live-worker.mjs r2 <bucket-name>`. Deploy with `cf deploy --prebuilt` from the corresponding `build/live-kv` / `build/live-r2` directory after checking the generated hostname is unused.

Run `node scripts/test-live-kv.mjs <kv-host>` and `node scripts/test-live-r2.mjs <r2-host>` from the repository root. KV reads retry for up to 80 seconds to accommodate eventual consistency; mutations are not blindly retried. Neither probe establishes geographic behavior or TTL expiry.

Cleanup order: probe deletes test keys/objects, `cf workers delete <worker-name> --force`, then `cf kv namespaces delete <namespace-id> --force` / `cf r2 buckets delete <bucket-name> --force`. Verify Worker/resource absence and exact-name DNS removal. Do not enable R2's public bucket domain.

## Core/Assets and service-binding probes

Core needs a dedicated KV namespace for `waitUntil` readback. After `npm run build:core`, run `node scripts/build-live-worker.mjs core <isolated-namespace-id>` and deploy from `build/live-core`. Static files are copied into Build Output's assets directory. Probe with `node scripts/test-live-core.mjs <host>`; delete the Worker and namespace afterward (the background-write key is intentionally retained until namespace deletion).

After `npm run build:service`, run `node scripts/build-live-worker.mjs service`. In `build/live-service`, deploy the **upstream first** with `cf deploy --prebuilt --worker <upstreamName-from-test-deployment.json>`, then deploy the default Worker with `cf deploy --prebuilt`. The upstream has no domains, workers.dev route or preview URL; access is through a native service binding only. Probe with `node scripts/test-live-service.mjs <frontend-host>`. Delete the frontend before its upstream, without forcing deletion of referenced resources, and verify both are absent.

## C++ Durable Object probe

`npm run build:durable` compiles the frontend and object to separate Wasm modules. Run `node scripts/build-live-worker.mjs durable`, check the generated hostname is unused, and deploy from `build/live-durable` with `cf deploy --prebuilt`. The cf export configuration creates an isolated SQLite `Counter` namespace; record its ID from `cf durable-objects namespaces list` (including all pages).

Run `node scripts/test-live-durable.mjs <host>`. Cleanup with `cf workers delete <worker-name> --force`, then verify Worker 404, exact-name DNS absence, and absence of the recorded namespace ID from the complete namespace listing. Do not assume deleting only the hostname removes stored objects.

## Queue and scheduled-event probes

Create a unique queue with `cf queues create --queue-name libcf-events-<10-hex-digits>` and a dedicated D1 database. Record both resource IDs. Run `npm run build:events`, then `node scripts/build-live-worker.mjs events <database-uuid> <queue-name>`. Deploy from `build/live-events` after the usual hostname collision check. This attaches a Queue consumer (batch size 1, 1-second timeout/retry delay, 3 retries) and an every-minute Cron trigger.

Run `node scripts/test-live-events.mjs <host>`. It checks live text/binary delivery and explicit retry/redelivery, then waits up to 20 minutes for a **real Cron invocation** to write controller metadata into D1. No public route can manufacture a scheduled invocation. HTTP certificate readiness has its own bounded wait; Queue lookups also use bounded waits. A producer 202 is not delivery evidence—the probe reads the consumer's D1 write.

Always clean up: find the exact consumer with `cf queues consumers list --queue-id <id>`, remove it with `cf queues consumers delete <consumer-id> --queue-id <id> --force`, delete the Worker (including Cron triggers), delete the queue and D1 database, and verify all resources plus DNS/certificates are gone. Do not leave the every-minute trigger running after a probe failure.

### Internal-only Cron diagnostic control

When Cron delivery is unresolved, compare plain JS and C++ against the same **new** database named `libcf-cron-db-<10-hex-digits>`. Create its schema with `cf d1 query <uuid> --sql 'CREATE TABLE cron_control(time INTEGER PRIMARY KEY,cron TEXT NOT NULL); CREATE TABLE schedules(id INTEGER PRIMARY KEY,cron TEXT NOT NULL,time TEXT NOT NULL);'`.

Build the C++ event example, then run `node scripts/build-live-cron-control.mjs <uuid>`. From `build/live-cron-control`, deploy the default plain-JS Worker with `cf deploy --prebuilt`, then the C++ Worker with `cf deploy --prebuilt --worker <generated-cpp-name>`. Deploying the default does **not** deploy every Worker in the output. Both have no domains, disabled workers.dev/previews, and only a D1 binding plus an every-minute Cron trigger.

Run `node scripts/test-live-cron-control.mjs build/live-cron-control/test-deployment.json --cleanup`. It queries D1 through `cf` for up to 20 minutes, requiring actual scheduled writes from both implementations. Its `finally` block deletes both Workers and D1, including after query/test failure, and verifies 404s. Resource names and the database's actual name are checked before taking ownership. The explicit `--cleanup` flag is destructive: only pass a manifest for newly created diagnostic resources. If the process is killed externally, perform that cleanup manually. Local fake-CLI tests cover successful observation, cleanup after query failure and refusal to own a non-test database; those tests make no network calls.

## Recorded attempt (2026-10-13)

- Worker: `libcf-cache-b97ca19200`
- Host: `libcf-cache-b97ca19200.libcf.leostera.dev`
- Version: `dad28a0f-2757-4bce-b91b-8115e437658d`
- `cf deploy --prebuilt --dry-run`: passed.
- `cf deploy --prebuilt`: passed; 118.71 KiB upload, 35.11 KiB gzip, reported startup 1 ms (single deployment observation, not a benchmark).
- HTTPS probe: **failed TLS handshake**, including after 12 readiness attempts. No live Cache runtime assertion was reached. Certificate activation delay is a possibility, not an established diagnosis.
- Cleanup: `cf workers delete ... --force` succeeded; subsequent `cf workers get ...` returned 404 / code 10007; exact-name DNS listing returned `[]`.
- Certificate inspection after deletion: the deployment-specific advanced certificate was `pending_deletion`; no claim that asynchronous certificate cleanup had already finished. Existing unrelated certificate packs were not modified. No certificate was ordered explicitly.

The first deployment's certificate subsequently disappeared from the certificate-pack listing, completing that cleanup.

## Successful retry (2026-10-13)

- Worker: `libcf-cache-7f75c5af09`
- Host: `libcf-cache-7f75c5af09.libcf.leostera.dev`
- Version: `390065b7-4c7f-4ac9-974f-f68ae1da00c5`
- Certificate status progressed from `pending_validation` to `active` after approximately five minutes. No explicit certificate order or TLS bypass was used.
- `node scripts/test-live-cache.mjs <host>` passed: default-cache miss, put, binary match, response headers and delete, at one client/location. Named cache, expiry, eviction and geographical behavior remain unverified live.
- Cleanup: Worker deletion succeeded, Worker lookup returned 404 / code 10007, and exact-name DNS listing returned `[]`. The certificate was `pending_deletion` at the initial post-cleanup check.
- An unauthenticated dry-run (temporary empty HOME) also passed, demonstrating the prebuilt CI check does not need account credentials.
- Full `npm test` passed after replacing the local Wrangler subprocess launcher with native Miniflare 5 configuration.
- The retry certificate subsequently disappeared from the certificate-pack listing, completing Cache cleanup.

## D1 live verification (2026-10-13)

- Worker: `libcf-d1-4284f85ede`
- Host: `libcf-d1-4284f85ede.libcf.leostera.dev`
- Version: `43d3a6e9-e673-498f-b22b-f6f583ba933d`
- Database: `libcf-d1-1fa5faabce`, UUID `275d544d-30af-4841-b2be-009e7e6fb956` (created in WEUR with replication disabled).
- `cf deploy --prebuilt --dry-run` and deployment passed; 144.10 KiB uploaded, 43.87 KiB gzip; reported startup 3 ms (single observation, not a benchmark).
- `node scripts/test-live-d1.mjs <host>` passed after certificate provisioning: setup/exec, binary CRUD, first/null/missing, batch commit, batch rollback and constraint errors. Rollback was verified by reading both attempted row IDs and observing 404s, not merely by checking the failed batch's response.
- Cleanup: Worker and D1 deletion succeeded; subsequent reads returned 404 (Worker code 10007, D1 code 7404); exact-name DNS listing returned `[]`. Certificate cleanup was `pending_deletion` at the first check.
- No live claim for sessions, raw queries, replication routing, arbitrary large results or operations absent from this probe.

## KV and R2 live verification (2026-10-13)

| Resource | Identity |
|---|---|
| KV Worker/host | `libcf-kv-cc2ffa59da` / `libcf-kv-cc2ffa59da.libcf.leostera.dev` |
| KV Worker version | `d3b63ad9-3576-4338-a945-18593ac1cdc5` |
| KV namespace | `libcf-kv-694322f9b2` / `10802e5e02764053aa439f4840c6f603` |
| R2 Worker/host | `libcf-r2-e3d1aaaaef` / `libcf-r2-e3d1aaaaef.libcf.leostera.dev` |
| R2 Worker version | `f003aa0d-a27f-4204-b2fe-5d049e1d937b` |
| R2 bucket | `libcf-r2-955e9de94b` (Standard, WEUR) |

Both deployments and HTTPS probes passed. KV verified empty/missing, binary values, metadata/TTL acceptance, prefix pagination, invalid metadata rejection and delete, with bounded eventual reads. R2 verified binary CRUD, metadata/ETag, HEAD, offset range, invalid offset, empty/missing, prefix pagination and delete. R2 managed-domain inspection reported `enabled: false`; no bucket-public endpoint was used.

Cleanup verified: both Worker lookups returned 404/code 10007, KV namespace lookup returned 404/code 10013, R2 bucket lookup returned 404/code 10006, and both exact-name DNS listings returned `[]`. A subsequent full certificate-pack listing contained no libcf hosts, completing certificate cleanup for these runs and the preceding D1 run.

During this work Linux CI exposed a transport race in the oversized-upload test (client `ECONNRESET` after early rejection). The test now sends only oversized Content-Length headers and requires 413 before providing a body; separate adapter tests prove both declared-length rejection and unknown-length stream cancellation return 413 before invoking any C++ export. No response-size limit was relaxed.

## Core, Assets and service live verification (2026-10-13)

| Resource | Identity |
|---|---|
| Core Worker/host | `libcf-core-2a399ebc8b` / `libcf-core-2a399ebc8b.libcf.leostera.dev` |
| Core Worker version | `39c5eee8-641e-4f03-b8aa-0e258b9a5db3` |
| Core KV namespace | `libcf-core-02da60d3f8` / `d3c4c37e7129475691d472a8b0464a31` |
| Service frontend/host | `libcf-service-513761233e` / `libcf-service-513761233e.libcf.leostera.dev` |
| Service frontend version | `ab3d0cf3-40e7-4560-b32d-06c0c5adb4e5` |
| Internal service upstream | `libcf-service-513761233e-upstream` |
| Upstream version | `5565eff4-1602-4964-bdaf-5242a499ae7b` |

Both HTTPS probes passed. Core verified routing, headers/string vars, `Assets.fetch`, binary echo, stream contents, client cancellation plus subsequent-request recovery, UUID format/uniqueness, concurrent request isolation and `waitUntil` KV persistence. This does not establish transport backpressure, delivery of cancellation to upstream I/O, cryptographic entropy quality or geographical consistency.

Service verified POST/binary/header forwarding, upstream HTTP 503 preservation, bodyless 204, oversized-response rejection, missing-binding errors and subsequent-request recovery. The upstream deployment reported **No targets deployed**; both workers.dev and previews were disabled. Only the frontend had a custom domain. RPC and end-to-end streaming remain unimplemented.

Cleanup: all three Worker lookups returned 404/code 10007; KV namespace lookup returned 404/code 10013; both exact-name DNS listings returned `[]`. The frontend was deleted before its upstream; no delete-with-references override was used. Certificate deletion is asynchronous and tracked separately.

A transient CLI 401 occurred when the previous OAuth access token expired. `cf auth whoami` refreshed authentication successfully; the failed resource creation was retried only after that check. No credentials were read or copied into project files.

## Named Cache live verification (2026-10-13)

- Worker/host: `libcf-cache-e7cffe06ce` / `libcf-cache-e7cffe06ce.libcf.leostera.dev`.
- Version: `7f0da291-cd56-487b-9246-b5d9d181d7c2`.
- Extended Cache probe passed: miss, put, binary match, headers, delete/absent distinction, default/named isolation and an empty value in a named cache. Deleting the named entry did not delete the default-cache entry at the same URL.
- Both test entries were deleted; Worker lookup subsequently returned 404/code 10007 and exact-name DNS lookup returned `[]`. The new certificate was `pending_deletion` at the initial cleanup check; the previous core/service certificates had disappeared.
- This remains single-client/location evidence, not a global cache, TTL-expiry or eviction guarantee.

## C++ Durable Object live verification (2026-10-13)

- Worker/host: `libcf-durable-4f2a9e62ac` / `libcf-durable-4f2a9e62ac.libcf.leostera.dev`.
- Version: `316211cd-46c7-4f20-abab-cdb36e4e5a35`.
- Auto-created SQLite namespace: `971f1a242ca647869693a44f2ee12dec`, `libcf-durable-4f2a9e62ac_Counter`.
- Deployment reconciled the `Counter` export and uploaded both frontend/object Wasm modules: 228.96 KiB total, 72.83 KiB gzip; reported startup 1 ms (not a benchmark).
- Live probe passed: gated C++ per-object initialization, eight concurrent atomic increments, independent objects, transaction rollback without changing the prior counter value, binary HTTP forwarding, parameterized SQL blobs, missing-binding/empty-name errors and C++ alarm effects.
- No forced live eviction or alarm retry was performed. Full runtime restart recovery was tested locally; alarm handling uses an idempotent armed-state update but the probe does not prove exactly-once platform delivery.
- Cleanup: Worker lookup returned 404/code 10007, exact-name DNS listing returned `[]`, and a complete namespace listing contained 32 entries (below the requested 100-entry page size) with neither the recorded namespace ID nor the deleted Worker script. Before deletion the listing contained 33 entries including that namespace.
- Linux CI for the C++ object implementation (`838c34d`) passed, including native sanitizer checks. A subsequent complete 24-entry certificate-pack listing contained no libcf hosts, confirming certificate cleanup for the DO and preceding runs.

## Queue live success and unresolved Cron probe (2026-10-13)

- Worker/host: `libcf-events-f098048113` / `libcf-events-f098048113.libcf.leostera.dev`.
- Version: `b52acb99-0e66-469c-aa6f-33e8561015fa`; upload 145.01 KiB / gzip 44.75 KiB; reported startup 1 ms (not a benchmark).
- Queue: `libcf-events-6b9e2c5f37`, ID `2f0ef6b631544e0eaba18a425742857e`; consumer `9660e48ffc764f3190da25e113c1e8d5`.
- D1: `libcf-events-db-7f0024723b`, ID `a9af1abd-f820-4c92-a8c0-4b2adc2be5e4`.
- Consumer listing confirmed this Worker, batch size 1, 1000 ms batch timeout, 3 retries and a 1-second retry delay. Deployment reported an every-minute Cron trigger.
- **Queue passed:** text/binary producer-to-consumer delivery with D1 readback, explicit retry before redelivery, and 128-KiB producer rejection. The live byte send used a copied Uint8Array. This is not proof of exactly-once delivery or forced duplicate delivery; a 16-message concurrent batch and duplicate-ID replay passed locally.
- **Cron unresolved:** `scripts/test-live-events.mjs` failed with `No real Cron invocation observed within 20 minutes`. HTTP status remained 404 for the scheduled readback; a direct D1 query also returned no scheduled row. An ad-hoc `cf observability telemetry query` filtered to this script and `$workers.eventType = cron` returned zero matching events. These observations do not identify the root cause or establish that Cron is unavailable. Do not mark live scheduling verified. A future isolated retry should inspect trigger application and compare a plain-JS scheduled control if necessary.
- Telemetry queries must filter by `$workers.scriptName`; using the Worker name as a dataset selector returned no events even though fetch invocations existed. Raw telemetry (including request metadata) remains ignored and is not committed.
- Cleanup commands succeeded for the exact consumer, Worker, queue and D1 database. Subsequent lookups returned Worker 404/code 10007, Queue 404/code 11000 and D1 404/code 7404; exact-host DNS listing returned `[]`. The certificate was initially `pending_deletion`; a subsequent complete 24-entry listing contained no libcf hosts, confirming its removal.
- Full local tests passed, including 6 event integration cases and 7 DO cases. Linux CI passed through `b251da1`, including the new assertion that private DO dispatch cannot be invoked through RPC. That RPC rejection has not been re-probed live.

### Follow-up: plain-JS versus C++ Cron control

- Internal-only Workers: `libcf-cron-js-1247b784fe` (version `f577e6c9-3b08-4d33-b0cc-5857811207bc`) and `libcf-cron-cpp-1247b784fe` (version `4635db3c-82e5-4e97-8d13-2da43fa78a5b`). Both reported an every-minute trigger on deployment and had workers.dev/previews disabled with no custom domains.
- Fresh D1: `libcf-cron-db-dc277df768`, ID `a26a5659-ec26-4c2d-b7a6-5d0c1402e8b5`. Both destination tables were created before deployment, removing schema creation from the plain-JS control handler.
- The diagnostic's 20-minute D1 observation window reported neither implementation throughout (`observed: []`) and failed. The failure is reproducible without C++/Wasm, but its control-plane/scheduler/runtime cause remains unidentified; this is not evidence that Cron is generally unavailable.
- Automatic cleanup completed with `cleanup: verified`, `failures: []`: both Worker lookups returned 404/code 10007 and D1 returned 404/code 7404. No DNS records or certificates were created by this internal-only experiment.

## C++ WebSocket live verification (2026-10-13)

Build with `node scripts/build-worker.mjs examples/websocket/wrangler.jsonc`, then `node scripts/build-live-worker.mjs websocket`. Deploy from `build/live-websocket` after checking the generated hostname for collisions. Run the opt-in `node scripts/test-live-websocket.mjs <hostname>`; all sockets use WSS under the approved namespace, with bounded waits and socket cleanup on failure.

- Worker/host: `libcf-websocket-b97ef07352` / `libcf-websocket-b97ef07352.libcf.leostera.dev`.
- Version: `fcc76296-97d5-4338-8316-3ffc3f3ea8f3`; SQLite namespace `93a50f4a341a43789f9420d3aa8750e1`, `libcf-websocket-b97ef07352_Room`.
- Upload: 141.43 KiB / gzip 44.64 KiB; reported startup 2 ms (not a benchmark).
- Passed: secure text/binary exchange, committed SQLite effects, client-initiated close and persisted close code, server close, handler failure (1011), oversized-frame rejection (1009) before C++ message effects, and HTTP upgrade guards.
- After 15 seconds idle, the same socket remained usable and the durable initialization counter advanced from 1 to 2. This demonstrates live object/Wasm reconstruction with connection continuity, not a forced live eviction test. Local tests additionally force hibernating eviction through Miniflare and verify the same properties.
- Cleanup: Worker lookup returned 404/code 10007; complete namespace listing decreased 33→32 with no matching namespace ID/script; exact-host DNS listing returned `[]`. Certificate removal was initially pending, then a complete 24-entry listing contained no libcf hosts.
- Implementation CI for `41c1ba4` passed, including native sanitizer checks and the new default-suite WebSocket tests. Outbound sockets, tags/attachments, broadcast, subprotocol negotiation and buffered C++ stub upgrade forwarding remain unsupported.

## Rate-limit live verification (2026-10-13)

Build the example, run `node scripts/build-live-worker.mjs rate-limit`, deploy from `build/live-rate-limit` after the hostname collision check, then run `node scripts/test-live-rate-limit.mjs <host>`. The builder generates fresh numeric namespaces rather than using local fixture IDs, and records them in `test-deployment.json`.

- Worker/host: `libcf-rate-limit-029c7d471b` / `libcf-rate-limit-029c7d471b.libcf.leostera.dev`.
- Version: `0666203d-a4a8-42d4-bdf6-a9173999aad7`; namespaces `7123489905606445` and `7123489905606446`, each configured for 2 requests/10 seconds.
- Upload 93.30 KiB / gzip 29.19 KiB; reported startup 2 ms (not a benchmark).
- Passed: allowed/exceeded outcomes, independent keys and namespaces, missing-binding errors, oversized-key rejection and later recovery after a bounded window wait. Three requests were allowed before the first exceeded result. The probe deliberately does not assert exact distributed counts or precise reset timing: these are approximate, location-scoped counters.
- Cleanup: Worker lookup returned 404/code 10007; exact-host DNS listing returned `[]`. The certificate was initially pending deletion; a subsequent complete 24-entry listing had no libcf hosts. Numeric rate namespaces are binding-defined counters, not separately provisioned resource objects; no claim is made that internal counter deletion/expiration was inspected.

## Version metadata live verification (2026-10-13)

- Worker/host: `libcf-metadata-1bdade156c` / `libcf-metadata-1bdade156c.libcf.leostera.dev`.
- Version `56302b17-3919-4d94-a4f7-3f16facc6a17`; observed timestamp `2026-10-13T14:15:40.700479Z`.
- `node scripts/test-live-metadata.mjs <host> <uploaded-version-uuid>` passed: the C++ ID matched the deployed version across three requests, the tag was empty, the timestamp was stable and parseable, and a missing metadata binding returned an explicit failure.
- Upload 109.31 KiB / gzip 32.56 KiB; reported startup 2 ms (not a benchmark).
- Only `VERSION` was bound. No Secrets Store binding, live secret read, or secret mutation occurred. Live secret verification requires an approved store for a uniquely named synthetic fixture.
- Worker deletion passed; lookup returned 404/code 10007 and exact-host DNS listing was empty. The managed certificate transitioned through pending deletion, then disappeared: the complete final listing had 24 entries and no libcf hosts.
- Implementation CI `38411409853` passed, including native sanitizer checks. Local secret rotation/deletion is simulator evidence, not live Secrets Store evidence.

## Web Crypto live attempts (2026-10-13): DNS blocked

- First Worker/host: `libcf-crypto-0c6391db31` / `libcf-crypto-0c6391db31.libcf.leostera.dev`; version `c04e95ed-8906-4afc-8316-b09026b95562`.
- Deployment succeeded without resource bindings. The bounded 15-minute HTTPS readiness loop ended with Node `getaddrinfo ENOTFOUND`; no digest assertions ran.
- Fresh diagnostic Worker/host: `libcf-crypto-c7e8207ab0` / `libcf-crypto-c7e8207ab0.libcf.leostera.dev`; version `e3f86775-695f-4028-b34c-6362b0121554`.
- During the second deployment, the DNS API showed its read-only, proxied AAAA record (`100::`), ID `4bf68c68968a233d454855252297886a`. DNS queries sent through the system resolver and to public/authoritative addresses still returned `NXDOMAIN`, with a negative SOA TTL initially 1800 seconds. A read-only HTTPS DNS diagnostic could not establish TLS (`SSL_ERROR_ZERO_RETURN`). No TLS bypass, IP-based Worker request, DNS-setting change or alternate test domain was used.
- Root cause remains unresolved: this does not establish a Crypto runtime limitation or distinguish provisioning from resolver-path/caching issues. Live digest coverage remains pending. The opt-in probe is `node scripts/test-live-crypto.mjs <host>`.
- Upload 122.92 KiB / gzip 34.35 KiB; reported startup 3 ms then 4 ms (not benchmarks). Implementation CI `38416367551` passed, including native sanitizers; full local tests passed.
- Both Workers were deleted and lookup returned 404/code 10007; both exact-host DNS listings became empty. Certificates transitioned through pending deletion and disappeared. Each final complete listing contained 24 entries and no libcf hosts. No active test deployment remains.

## Independent TXT diagnostic (2026-10-13, 16:45 UTC)

- The zone API reported active/full/unpaused status; assigned nameservers matched the public apex NS answer. A shadowing-NS query returned none. The test parent returned NXDOMAIN before probe creation.
- Created only `dns-probe-0a5577b14b97.libcf.leostera.dev`, unproxied TXT, TTL 60; record ID `5dccb4d938a25f83d30e8df4a4d3d9b4`. Exact-name API readback matched its synthetic content and identity.
- System/public resolver queries and queries addressed to both assigned nameservers returned NXDOMAIN, including nonrecursive TCP queries and a retry after 30 seconds. Negative SOA TTL was 1800, then 1770 seconds. Address-directed answers advertised AA and RA; these are not independent proof of the actual answering path.
- This reproduces the symptom without any Worker, but does not identify its cause: the short probe did not outlast the negative TTL. Caching, publication delay and resolver-path mediation remain unresolved. No runtime capability was marked live-verified.
- Deleted the owned TXT record; the exact-name API listing was empty at 16:45:37 UTC. No Worker/certificate, delegation change, TLS bypass or unrelated resource mutation occurred. No active test resource remains. Further diagnosis should outlast the negative TTL and use an independently verified resolver path before redeploying fixtures.

## TXT follow-up after the negative TTL (2026-10-13, 17:11–17:42 UTC)

- Held `dns-probe-cfdec8dc4f0e.libcf.leostera.dev`, unproxied TXT with TTL 60, record ID `bceca03b2331c4bfeda50ad6fdcd2e09`, for a 31-minute wait after the initial queries. Initial system and nonrecursive TCP queries returned NXDOMAIN with negative TTL 1800.
- At 17:42 UTC the API still returned the same record and synthetic content. System/public, nameserver-addressed UDP and nonrecursive TCP queries then all returned NOERROR with the exact expected TXT value.
- This establishes recovery for this isolated record after outlasting the negative TTL. It is consistent with caching/publication delay, not proof of a unique cause, a guaranteed propagation deadline or independent resolver paths. Earlier digest attempts remain unverified.
- The background diagnostic deleted the exact owned record and verified an empty exact-name API listing at 17:42:31 UTC. No Worker/certificate or zone-setting change was involved; no active test resource remains. Future live retries should retain one hostname through a bounded wait long enough to accommodate the observed negative TTL rather than repeatedly deploying fresh hosts.

## Web Crypto successful retry (2026-10-13, 17:55–17:57 UTC)

- Worker/host: `libcf-crypto-09d51398ce` / `libcf-crypto-09d51398ce.libcf.leostera.dev`; version `f4436046-1801-42b5-b965-0ab6b7ad5763`. Worker 404/code10007 and an empty exact-host DNS listing established ownership before deployment. No resource bindings were provisioned.
- `LIBCF_LIVE_READY_TIMEOUT_MS=2400000 node scripts/test-live-crypto.mjs <host>` passed over verified HTTPS. SHA-256/384/512 matched Node for empty, binary and 1-MiB input; six concurrent SHA-256 requests stayed isolated; oversized input rejected and a subsequent request succeeded. RNG outputs differed and UUID v4 format passed; this is not an entropy audit.
- The whole probe/cleanup run finished within two minutes; the 40-minute readiness allowance was not exhausted. This confirms this retry, not a retroactive pass for the earlier DNS failures or a universal provisioning time.
- Upload 131.29 KiB / gzip 36.33 KiB; reported startup 2 ms, not a benchmark.
- Worker deletion and 404/code10007 verification passed. Exact-host DNS became empty. The complete final certificate listing contained 24 entries and no libcf hosts; cleanup finished at 17:57:22 UTC. No active live test resources remain.
