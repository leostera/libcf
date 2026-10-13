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

The builder only emits artifacts; it neither deploys nor creates resources. Do not regenerate artifacts while a previous deployment still needs cleanup: retain its identity from `test-deployment.json`. The probe checks a single client/location, not global cache consistency, TTL or eviction. Its readiness phase allows roughly fifteen minutes for custom-domain certificate activation; that window is not a promise of certificate provisioning time.

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
