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
