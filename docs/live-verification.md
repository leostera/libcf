# Live verification

## Rules

Use the authenticated **cf CLI**, not Wrangler. All online test endpoints must be under **`*.libcf.leostera.dev`**, with `workersDev: false` and `previewUrls: false`. Do not bypass TLS verification. Deployment/resource mutations are opt-in and must not enter the default local test suite. Keep resource names isolated, check for collisions, and remove test deployments and domain/DNS attachments afterward.

Current CLI baseline: `cf` **1.0.0-beta.6**. The prebuilt deployment adapter uses Cloudflare Build Output Specification **v0**, which is experimental and may change. It avoids depending on a Wrangler build/deploy command. Existing local example launchers have not yet been migrated to cf.

## Cache deployment probe

```sh
npm run build:cache
node scripts/build-live-cache.mjs
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

The builder only emits artifacts; it neither deploys nor creates resources. Do not regenerate artifacts while a previous deployment still needs cleanup: retain its identity from `test-deployment.json`. The probe checks a single client/location, not global cache consistency, TTL or eviction. Its readiness phase allows roughly two minutes for custom-domain certificate activation; that window is not a promise of certificate provisioning time.

## Recorded attempt (2026-10-13)

- Worker: `libcf-cache-b97ca19200`
- Host: `libcf-cache-b97ca19200.libcf.leostera.dev`
- Version: `dad28a0f-2757-4bce-b91b-8115e437658d`
- `cf deploy --prebuilt --dry-run`: passed.
- `cf deploy --prebuilt`: passed; 118.71 KiB upload, 35.11 KiB gzip, reported startup 1 ms (single deployment observation, not a benchmark).
- HTTPS probe: **failed TLS handshake**, including after 12 readiness attempts. No live Cache runtime assertion was reached. Certificate activation delay is a possibility, not an established diagnosis.
- Cleanup: `cf workers delete ... --force` succeeded; subsequent `cf workers get ...` returned 404 / code 10007; exact-name DNS listing returned `[]`.
- Certificate inspection after deletion: the deployment-specific advanced certificate was `pending_deletion`; no claim that asynchronous certificate cleanup had already finished. Existing unrelated certificate packs were not modified. No certificate was ordered explicitly.

Next attempt should inspect certificate status while the deployment still exists and allow a longer bounded provisioning window, without changing domain namespace or TLS checks. Live Cache coverage remains unverified.
