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
- Malformed input bytes reject with a local generic Error beginning
  `Unexpected error response 500: Error: Input buffer contains unsupported image format`.
  This is not proof of production ImagesError codes or every malformed-input case.
- Hosted upload of one explicit owned ID, details, original-byte equality, creator
  listing, metadata replacement, delete, null details/bytes readback, empty listing
  and a second delete returning false. A preexisting fixture ID aborts the probe.
  Failure cleanup is limited to that attempted owned ID; primary and cleanup
  failures are preserved together. Owned handles are conditionally disposed.
- The first test incorrectly expected result `.metadata`; correcting it to `.meta`
  followed both official docs and pinned source, not a runtime compatibility shim.

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

## Next bounded subset and live gate

A narrow PNG-input rotate/resize-to-PNG client is feasible locally. Keep SVG,
text/font sources and their external-resource interpretation outside the first subset. It still needs bounded
owned input snapshots, supported dimensions/options, output-stream limits, explicit
pending/transformer/result ownership, alias-aware cleanup and cooperative abort/
deadline handling, native codecs and an actual C++/Wasm example. Dimension/byte
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
