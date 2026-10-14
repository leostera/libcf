# Legacy Workers Sites readiness

Snapshot2026-10-14, Miniflare5.20261006.1-alpha/workerd1.20261006.1,
compatibility date2026-10-13. P12 remains an **optional, incomplete compatibility
track**. There is no libcf Sites API/operation/C++ example or live verification.
Modern Assets support is not legacy manifest/KV behavior.

## Product and runtime scope

Cloudflare's current Sites overview says it is deprecated in Wrangler4, unsupported
by the Vite plugin and not recommended for new projects; use Workers Static Assets
instead. Deprecation is not evidence that existing Worker-accessible Sites reads
are impossible. Sites uses Workers KV and usage charges may apply.

Sites configuration selects a bucket directory with include/exclude patterns;
include takes precedence when both are specified. The module-Worker guide imports
`__STATIC_CONTENT_MANIFEST`, parses it and explicitly supplies that mapping plus
`env.__STATIC_CONTENT` to kv-asset-handler. It does not read the module manifest
from env or globals. Classic service-worker globals are a separate format.

The pinned simulator exposes `workers[].legacy.sitePath/siteInclude/siteExclude`.
Its KV plugin builds a manifest and namespace; module Workers receive a generated
text module named `__STATIC_CONTENT_MANIFEST`, not an env/global manifest binding.
Local manifest values are `$__MINIFLARE_SITES__$/` plus encodeURIComponent(path),
not production content hashes. The filesystem-backed Sites worker filters reads
and has explicit405 handling for non-GET methods; its disk service is configured
writable, so this is an API-layer restriction, not a proven filesystem sandbox.

## What the local probe establishes

`tests/sites-platform.test.mjs` runs native local Sites with an owned temporary
asset directory and a module Worker, directly through Miniflare under Bazel—no
Wrangler subprocess, remote namespace, upload or account operation:

- Manifest import works; both env/global manifest properties are absent.
- Manifest values match the local encoded-key scheme; text and binary contents
  (including a filename with a space and Unicode) round-trip via the Sites KV API.
- An excluded file and a missing key return404, including direct raw-key access
  to the excluded file. Reconfiguration confirms include overrides exclude.
- DELETE rejected with `KV DELETE failed: 405 Cannot delete() with Workers Sites
  namespace`. Initial PUT did not settle within a5-second outer timeout. The
  retained bounded probe races each mutation against200ms and records rejection
  **or deadline**, never promotes a timeout to successful denial/cancellation.
  Locally PUT again hit the deadline; DELETE rejected. The fixture file remained
  unchanged before reconfiguration and after disposing the local instance.

The old sibling ReScript inventory's negative direct-Miniflare/module observations
must not be generalized into unavailability: its installed version matches ours,
but the explicit worker-level legacy configuration and module import above pass.
This does not rerun or invalidate its separate classic-Wrangler evidence; no sibling
files were changed. Exact configuration and manifest access path matter.

This is native local **feasibility evidence**, not a C++ bridge, asset HTTP handler,
production hashing/cache behavior, MIME/ETag/range/HEAD/conditional semantics,
path-normalization policy, symlink/traversal isolation or live KV verification.
The test permits either a rejected or timed-out mutation so CI does not manufacture
a portable timing claim. Mutations are not a proposed libcf Sites API.

## Harness and deployment boundaries

The ordinary fixture harness now rejects every own `site` declaration, including
null/false/empty/remote:false and additional configs, before bundling that worker.
It previously had no Sites mapping and could silently omit it. Explicit native
probes use their own owned directory and generated manifest. The policy test is
configuration rejection, not isolation of arbitrary code or arbitrary filesystem
paths.

The inspected cf CLI1.0.0-beta.6 deployment entrypoint passes
`syncWorkersSite: undefined` to its bundled deployment helper. That helper contains
conditional Sites synchronization and manifest/KV upload support, but the inspected
entrypoint does not supply the automatic synchronization callback. Do not infer
that a legacy `site.bucket` will be uploaded merely because helper code exists.
No CLI deployment/dry-run was attempted. This does **not** prove all explicit
KV-binding/text-module deployments through cf are impossible; a manual owned
manifest/upload pipeline needs separate implementation and verification. Do not
restore Wrangler subprocesses or a CMake build to work around this gap.

## Remaining implementation and verification

If pursuing this optional track, implement a narrow read-only manifest-key API:
bound manifest materialization/projection, entry/name/key/body sizes, require own
mapping entries, never fall back to arbitrary raw namespace keys, and define URL
versus logical-key handling. Preserve binary/empty/missing semantics, borrowed
namespace identity, request lifetime, deadlines and late-result cleanup. Prefer
module format; no need to claim classic-worker parity.

A dedicated Bazel C++/Wasm example must preserve the special manifest module across
bundling and test owned mapping failures, encoded/Unicode keys and response limits.
Do not relabel generic KV or Assets tests as Sites verification. Full asset-serving
semantics and production content-hash uploads/cache invalidation are separate work.
Before live work, define the explicit cf deployment path, owned namespace/files,
request/storage budget, domain policy and independent cleanup of assets/namespace
and Worker. Worker deletion/disposal alone is not KV deletion or cache erasure.

## Sources

- [Sites overview](https://developers.cloudflare.com/workers/configuration/sites/)
  (updated2026-04-23); [configuration](https://developers.cloudflare.com/workers/configuration/sites/configuration/);
  [module-Worker example](https://developers.cloudflare.com/workers/configuration/sites/start-from-worker/).
- Pinned Miniflare WorkerOptionsSchema/KV plugin/module injection and
  workers/kv/sites.worker.js. Index SHA256
  `141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482`;
  Sites worker `5a479abbdea7aa58bbccce3ece08fa6b00a42aa90a49aa7eddc34e8d674244e5`.
- Installed cf CLI shared deployment entrypoint SHA256
  `27c10373d61680e3bdeaf5d11dc3f8d1f0076384cb85bc711bdfc97900709a2d`;
  conditional sync helper inspected, not executed. Not a pinned Bazel build input.
- Local probe and `tests/sites-policy.test.mjs`; the optional inventory row remains open.
