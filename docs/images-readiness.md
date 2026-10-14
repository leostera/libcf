# Images transform and hosted-storage readiness

Audit2026-10-14, pinned Miniflare5.20261006.1-alpha/workerd1.20261006.1,
compatibility date2026-10-13. Existing libcf C++ support remains `Images::info()`.
Native local feasibility below is **not** a C++ transform/hosted implementation or
live verification. No account lookup, plan purchase, external image/font fetch,
real upload, signed URL, direct-upload grant or provider resource was created.

## Worker-accessible surfaces

Current official binding documentation (updated2026-09-02) distinguishes:

- Optimization: `input(stream)` or `text(content,options)`, chained `transform`/
  `draw`, then `output({format,...})` and `response()`. Input bytes are not required
  to have a public URL. Text fonts can require an external URL fetch; exclude that
  capability from default local fixtures and any initial bounded transform client.
- Hosted storage: `env.IMAGES.hosted.upload/list/createDirectUpload` and
  `hosted.image(id).details/bytes/update/delete/signedUrl`. These are documented
  **Worker binding APIs**, not dashboard-only/REST-only operations. The image
  handle itself is documented as cheap construction; storage calls are not.

The hosted namespace spans account images. IDs, creator filters and metadata
filters do not authorize access. Upload/update option `metadata` becomes result
field **`meta`**; update replaces that object, not merges it. `details()`/`bytes()`
return null when absent, `bytes()` streams originals, and delete returns a boolean.
Delivery URLs in metadata are neither ownership proof nor permission to fetch.

Hosted operations require a paid Images storage plan. Published pricing (updated
2026-10-12): storage purchased in$5/100000-images/month increments, delivery
$1/100000 images, and transformations first5000 unique/month included then
$0.50/1000 on Paid. Free transformations have a limit rather than overage charges.
No account entitlement, remaining allowance or pricing agreement was checked.

Binding transforms count unique source+parameter combinations by calendar month;
`.info()` is documented free. Billing deduplication is **not response caching**:
uncached transformation calls still decode/re-encode. Hosted delivery URLs count
as delivery, while transforming hosted bytes via the binding counts as transforms.
Worker compute, storage/delivery and any external fetches are separate concerns.

## Pinned local evidence

The pinned plugin wraps `cloudflare-internal:images-api`. Without a remote proxy,
it uses a local Images service backed by a KV/DO store; optimization goes through
the loopback service and pinned Sharp0.35.5. An explicit remote proxy selects a
different backend. Native local results do not establish production parity.

`tests/images-platform.test.mjs` creates its own temporary persistence directory
with shared storage disabled, uses only a generated2x3 PNG, and removes the
runtime/directory afterward. It does not invoke Wrangler or provision anything.

Verified through the native binding, not a replacement fake Images object:

- `input(...).transform({rotate:90}).output({format:'image/png'})`, content type
  and response bytes. A tiny independent PNG decoder checks every chunk CRC,
  decompresses with an exact size bound, reconstructs all scanline filter modes,
  and verifies every expected red/green RGBA pixel in the resulting3x2 image.
  This is more than signature/IHDR proof, but only for this synthetic raster case.
- Malformed input bytes reject with name `Error`, code9523, and a message beginning
  `Unexpected error response 500: Error: Input buffer contains unsupported image format`.
  An Error name alone does not establish absence of a typed code. This local
  fallback code is not proof of the production code for malformed image data.
- Hosted upload of one explicit owned ID, details, original-byte equality, creator
  listing, metadata replacement, delete, null details/bytes readback, empty listing
  and a second delete returning false. A preexisting fixture ID aborts the probe.
  Failure cleanup is limited to that attempted owned ID; primary and cleanup
  failures are preserved together. Owned handles are conditionally disposed.
- The first test incorrectly expected result `.metadata`; correcting it to `.meta`
  followed both official docs and pinned source, not a runtime compatibility shim.

## Builder and output ownership

Native probes also establish that `transform()` aliases its input builder, repeated
`result.image()` calls return the same stream, and `result.response().body` aliases
that stream. These are not independent image copies. The probe fully consumes the
body before returning. A second `.output()` rejects with code9525 after either a
successful output or the malformed-input failure above; do not retry a consumed
builder or share one across requests.

The workerd tag matching the runtime version corroborates these observations:
`ImageTransformerImpl.transform()` pushes the supplied options object and returns
`this`; output marks the builder consumed before fetching. `TransformationResultImpl`
retains a Response; default `image()` exposes its body without starting a transform,
and `response()` wraps that same stream. A future adapter must snapshot options,
retain roots through body consumption, deduplicate alias cleanup, and use only the
known result accessor to cancel late/unconsumed output. The source's output fetch
has no caller AbortSignal forwarding. A local deadline is not evidence of stopped
provider work or billing. This source review is not binary reproducibility proof.

## Limits and unsupported claims

Official local-development docs call offline optimization low-fidelity, listing
width/height/rotate/format. The pinned local implementation also contains other
branches, but source presence is not verified behavior or production fidelity.
Do not infer text/font, overlays, animation, all encodings, color-management,
metadata preservation, fit/quality or arbitrary-image parity from this probe.

Hosted simulator source also has important differences/limits:

- Listing enumerates stored records before filtering/pagination. A page limit is
  not a bound on native materialization, scans, account access or billing.
- Local service upload/update source does not show every documented custom-ID/
  private-access restriction; whether the binding facade supplies those checks
  was not verified. The service's signed-URL implementation uses a built-in
  simulator secret, not evidence of account signing-key behavior. Neither signing nor direct upload
  was exercised here, and no generated URL was followed.
- Local deletion/readback is not production cache invalidation, retention cleanup,
  stopped billing or erasure of previously issued URLs/capabilities.

## Bounded JS rotation prototype

`lib/image-rotate.mjs` now implements `performImageRotate(binding, bytes, timeout,
signal?)`: one fixed clockwise90-degree rotation, PNG output and `anim:false`.
This is not yet dispatched through the Wasm host ABI or exposed as a C++ method.

- Canonical decimal timeout1–60000ms; input/output at most1MiB; declared width and
  height1–1024;8-bit RGB/RGBA only. Interlace0/1 accepted. PNG signature, first IHDR,
  chunk framing/types, at most1024 chunks, consecutive nonempty aggregate IDAT,
  optional palette placement and final IEND checked. APNG control/frame chunks,
  unknown critical chunks, trailing bytes and unsupported headers reject.
- Input is copied before provider access/yield. Output is copied incrementally via
  `readBounded`; output dimensions must swap the input dimensions. These are
  **framing checks, not CRC or pixel/decompression validation**. Ancillary metadata
  is not stripped; declared bounds do not establish provider decode memory/CPU.
- Fresh per-call builder; fixed fresh options; preserved method receivers; retained
  input/builder/pending/result/body roots; reverse identity-deduplicated conditional
  disposal excluding the borrowed binding. Known late image access is cleanup
  only. Reentrant access is cached once, late rejections drained, streams canceled
  best-effort without awaiting producer cancellation. Cleanup rejects success but
  preserves a primary error. No retry or implicit cache.
- Unit tests cover framing/bounds, snapshots, aliases/order, malformed output,
  primary errors, deadlines, active and late cancellation, synchronous reentrant
  abort and malformed Promise rejection drainage. Mock framed output is explicitly
  not evidence of decoded pixels. The bundled JS prototype also runs against the
  native binding: independently decoded rotation pixels plus8 concurrent calls.

SVG, text/fonts, arbitrary URLs, other angles/resize/formats and hosted mutations
are not part of this prototype. No account operation or live transform occurred.

## Remaining implementation and live gate

The JS rotation prototype still needs a strict C++ codec, opcode dispatch and an
actual emitted-bundle C++/Wasm example. Broader resize/format APIs remain open.
Keep SVG, text/font sources and their external-resource interpretation outside
this first subset. Preserve the JS ownership and boundary guarantees across that
C++/Wasm call graph rather than relying on caller discipline. Dimension/byte
projection caps do not prove bounded provider decompression or processing cost.
Do not introduce arbitrary URL/font fetch, implicit caching or hosted writes as
part of transformation convenience methods.

Hosted API clients need a separate ID/data/metadata/URL authority model, explicit
mutation semantics, request lifetimes and bounded result projections. Keep native
account operations gated on an owned fixture, paid-plan/cost approval, exact
operations/data, expiry where applicable, and independent asset/Worker cleanup.
Never enumerate existing account images or reuse signing keys as a shortcut.

Sources: [optimization binding](https://developers.cloudflare.com/images/optimization/binding/),
[hosted binding](https://developers.cloudflare.com/images/storage/binding/),
[pricing](https://developers.cloudflare.com/images/pricing/), pinned Miniflare
`dist/src/index.js` SHA256
`141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482`,
`workers/images/images.worker.js` SHA256
`af2899ca6a60f748d82ade88cdfcf1cb6b87d04855f838ed2cbe71fbcfb34ef6`.
Tagged [workerd Images implementation](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/cloudflare/internal/images-api.ts)
SHA256 `056a9523d3479b162ffa426d7c0cf4aee8a2a2716654c4a232c7be5c67113553`;
reviewed as source evidence, not added as a build dependency.
