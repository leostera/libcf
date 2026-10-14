# Legacy Workers Sites readiness

Snapshot2026-10-14, Miniflare5.20261006.1-alpha/workerd1.20261006.1,
compatibility date2026-10-13. P12 remains an **optional, incomplete compatibility
track**. A bounded JS manifest/stream-read prototype is now tested with native
local Sites; there is no C++ API/operation/example or live verification.
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

## Bounded read-only JS prototype

`lib/sites.mjs::parseSitesManifest` transforms JSON text into an opaque frozen
manifest token backed by a private mapping. At most1MiB UTF-8 JSON and1024 own
string entries; logical and physical keys1–512UTF8bytes. JSON parsing follows JS
duplicate-key semantics and the shared depth/node bounds, not lossless duplicate
rejection. Caller code cannot mutate/forge the token's internal mapping without
parsing a new manifest. Parsing establishes structure, **not mapping authority**:
use a trusted deployment manifest, never request-supplied mappings. Native manifest
generation/module loading precedes these parser caps.

Logical keys and non-local physical keys use a deliberate relative-path subset:
no empty/dot/dot-dot segments, leading/trailing slash, segment-edge ASCII spaces,
backslash, percent, colon, query/fragment characters, C0/C1/DEL controls or BOM.
Unicode and internal spaces are preserved; there is **no URL decoding or
normalization**. This excludes some legal filenames/KV keys, not a complete path
or filesystem-isolation policy. Local-prefixed values must exactly equal the
simulator prefix plus encodeURIComponent(logical key), within the512-byte bound;
other physical keys are not verified content hashes.

`performSitesGet(namespace, token, key, emptyBody, timeout, signal)` performs only
`namespace.get(mappedKey, 'stream')`. Timeout is canonical decimal1–60000ms. A
manifest miss makes no namespace access and never falls back to the raw key;
that does not prove a namespace exists. A mapped KV null also returns Missing.
An empty stream returns present empty bytes, distinct from Missing.

The result is owned raw bytes0–1MiB, copied incrementally through `readBounded`;
not an arrayBuffer materialization before checking the output cap. It requires a
real ReadableStream with byte chunks, retains pending/result roots through reading,
excludes the borrowed namespace, and disposes owned roots in reverse with identity
deduplication. Late/unconsumed streams are canceled best-effort; active readers
receive the combined deadline/abort signal. Cancellation promises are not awaited,
so hanging producer cleanup cannot replace the size/deadline failure. Cleanup
errors reject success while preserving primary failure. Upstream buffers/read
work, KV billing and actual stopped work are not bounded/proved by this projection.
Deadline handling is cooperative JS scheduling, not CPU preemption of producers.

`tests/sites-adapter.test.mjs` covers exact manifest/entry/key/body bounds, own prototype-named keys,
canonical local mappings, missing/empty differences, reused chunks, disposal and
lookup/read cancellation. `tests/sites-adapter-platform.test.mjs` uses the actual
pinned Sites namespace and imported manifest: native stream text/binary/empty reads,
8 concurrent reads, exact1MiB output, oversize rejection, excluded/unmapped keys,
invalid paths, stale manifest after owned local file removal and recovery. No
production hash/cache/consistency claim, raw namespace fallback or mutation API.

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

Next: wire the bounded prototype into a typed C++ read-only manifest-key API and
strict owned-byte decoder, preserving binary/empty/missing semantics. Prefer module
format; no need to claim classic-worker parity.

The Bazel bundler now preserves the exact `__STATIC_CONTENT_MANIFEST` import and
records it in schema2 `bundle.json.requiredTextModules`, derived from emitted
imports after tree shaking. It does not fabricate or upload the text module.
`tests/bundle-modules.test.mjs` runs the emitted bundle with a supplied synthetic
text module and verifies missing-module startup failure. This is module linkage
proof, not native Sites namespace/upload verification.

A dedicated Bazel C++/Wasm example must still connect the native manifest/namespace
and test owned mapping failures, encoded/Unicode keys and response limits.
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
