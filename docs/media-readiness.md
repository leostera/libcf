# Stream, Media Transformations and Browser Run readiness

Audited 2026-10-14 using current docs, Miniflare 5.20261006.1-alpha and Workers
types 5.20261010.1. The subsequent bounded Media frame subset is described below;
Stream and Browser C++ APIs remain unimplemented. The named Media GIF subset has
[now passed a clean-source live probe](live/bazel-media-2026-10-14.json), with
Worker, DNS and matching certificate absence independently verified.
These are distinct products and must not inherit one another's support or pricing.

## Stream library binding

The Worker-accessible API includes URL upload, direct-upload creation, video
handles/details/update/delete/token generation and videos/watermarks collections.
It is not merely an account REST API. Miniflare has a local SQLite/blob-backed
simulator, but its scope differs from production:

- A real workerd/Miniflare test now verifies an empty video list and missing-video
  failure, and observes `createDirectUpload is not supported in local mode`.
- That failure is a **local simulator limitation**, not a claim that the production
  direct-upload API is unavailable. No upload slot or remote resource was created.
- The local implementation also accepts raw stream upload input beyond the
  published URL-only binding signature. Do not use that convenience as evidence
  that a C++ byte-upload API works in production.
- Metadata/storage simulation is not transcoding, HLS/DASH playback or delivery
  evidence. The test does not fetch video sources, watermarks or playback URLs.

Stream storage is prepaid in $5/month increments per 1000 minutes. Unfinished direct
uploads reserve maxDurationSeconds; creation is not a free existence probe.
Delivery is $1/1000 minutes; preloading/buffering/downloads can count. Published
pricing starts WebRTC delivery billing on October 15, 2026. Confirm capacity and
budget before live tests; acknowledgement is not playable output. Never buy
storage or enable a subscription implicitly.

## Media Transformations binding

`input(ReadableStream).transform(...).output(...)` is a fixed-order, single-use
chain; the input cannot be reused across transformations. Results expose media
streams, Responses and content type. A bounded C++ subset must own input bytes,
cap output consumption and handle cancellation without claiming remote rollback.

The implemented subset is `cf::Media::frame_png(MediaFrameRequest)`, operation384:
first frame at `0s`, PNG, contain fit, 10–512 requested width/height (default 128),
1 MiB owned input/output and a cooperative local 1–60000 ms deadline (default 5000).
It invokes input/transform/output/response once, never reuses the chain or disposes
the borrowed environment binding, and keeps builders request-local. MIME and PNG
signature checks are not a full decoder or actual output-dimension verification.
No generic native-handle disposal method or undocumented signal option is assumed.
The wire key is empty, body is raw video bytes, options are decimal
`width:height:timeout_ms`, and the value reply is raw PNG bytes.

The [example](../examples/media/README.md) runs actual C++/Wasm with an explicit
provider mock returning a fixed PNG, not a native decoder. Native/adapter tests
cover malformed input/output, receiver preservation, ownership, bounds, pre/active
abort, late response/rejection cleanup, body-read deadline and recovery. Input
cancellation is best effort when unlocked; output readers own their cancellation.
Native buffers/codec memory, blocked event loops and continued remote work are
not bounded by these SDK limits. Live source `4bdcf17` returned PNG MIME/signature
and 128×128 IHDR from the synthetic GIF, rejected unauthorized and invalid calls,
and recovered afterward. This does not establish full PNG decoding, pixel colors,
MP4, other modes, live concurrency, caller-abort or response-overflow behavior.

Pinned Miniflare's Media plugin is remote-only. The local harness rejects its
production config before bundling; future explicit mocks are M, not provider L.
The current binding documentation says public open beta transformations through
this binding are **not billed**. This is separate from Stream storage/delivery and
must be rechecked before any live probe. No transformation was executed here.
The prepared opt-in probe uses an owned 448-byte animated GIF and authenticated
isolated ingress; at most three processing attempts, no transformation retries,
URL crawling, AI or account storage. Only a token hash is deployed. The private
token file must remain local and is not printed in preparation/probe reports.
Default tests decode the fixture with local Images/Sharp, verify native auth and
exercise artifact policy and a mocked probe; none is native Media evidence.

The refreshed [general Media page](https://developers.cloudflare.com/stream/transform-videos/)
lists MP4/H.264 in source recommendations and also animated GIF under limitations.
The GIF probe does not establish MP4 support. That page separately documents
URL/zone transformations at $0.50 per 1000 unique monthly transformations with
5000 included; the binding-specific beta nonbilling statement remains distinct.
Do not toggle zone settings or buy subscriptions to run this binding probe.

## Browser Run

The binding supports raw fetch, Quick Actions returning Response objects, and
session APIs including acquire/connect/close. A screenshot's binary result, an
HTTP error and a content action's JSON envelope must not be conflated. Session
close acknowledgement can say closing; it is not an independent absence readback.

Miniflare supports local browser sessions as well as remote proxy mode. Its pinned
source selects Chrome 126.0.6478.182 and can download/install it at runtime. That is
**not yet a declared/checksummed Bazel browser artifact** or a verified libcf local
browser target. Do not trigger hidden browser downloads, use a personal browser
profile or label all Browser Run APIs remote-only. Pin/provision the browser and
host prerequisites explicitly before adding default local tests; use offline
fixtures and deterministic cleanup. No browser was launched in this audit.

Quick Actions bill browser hours; sessions additionally bill concurrent browsers.
Published Free allowance is 10 minutes/day and 3 concurrent sessions; Paid includes
10 hours/month and 10 average concurrent sessions, then $0.09/hour and $2/additional
concurrent browser. Remaining account allowance is unknown. A bounded request
still needs resource/time and usage planning, especially with page navigation,
JavaScript execution, external subresources or AI-backed extraction.

## Sources

- [Stream binding](https://developers.cloudflare.com/stream/manage-video-library/bindings/)
- [Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [Media binding](https://developers.cloudflare.com/stream/transform-videos/bindings/)
- [Browser binding](https://developers.cloudflare.com/browser-run/reference/browser-binding-api/)
- [Browser pricing](https://developers.cloudflare.com/browser-run/pricing/)
- Pinned Miniflare STREAM_PLUGIN, MEDIA_PLUGIN, BROWSER_RENDERING_PLUGIN,
  stream/binding.worker.js, ensureBrowserInstalled/launchBrowser and BROWSER_VERSION.
- [Local simulator regression](../tests/stream-platform.test.mjs).

A guessed media-transformations documentation index returned 404; the supported
Media documentation was located through Stream's documentation index instead.
That failed URL was not treated as evidence of missing platform support.
