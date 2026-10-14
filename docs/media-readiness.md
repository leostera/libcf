# Stream, Media Transformations and Browser Run readiness

Audited 2026-10-14 using current docs, Miniflare 5.20261006.1-alpha and Workers
types 5.20261010.1. The subsequent bounded Media frame subset is described below;
Stream now has a read-only C++ metadata subset; Browser remains unimplemented.
The named Media GIF subset has
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
- A second real simulator test imports the owned448-byte synthetic GIF through
  the published URL-argument shape, using exactly one HTTP fetch from an owned
  loopback server. It lists the resulting ID and reads scoped metadata, then
  deletes the fixture and independently observes missing details and an empty
  fresh list. No returned thumbnail, watermark or playback URL is fetched.
- The simulator reports ready=true/state=ready but duration=-1 and dimensions0×0
  for that known16×16,200ms fixture. These are simulated metadata, not transcoding,
  GIF acceptance in production, playable output, HLS/DASH or delivery evidence.
- Both the videos property and video(id) yield awaitable RPC handles locally.
  Tests release the pending handles, resolved scopes and returned calls/results;
  retired scopes reject reuse while fresh lookups keep working. This verifies
  local RPC scope ownership, not production Stream cancellation or lifetime parity.

`cf::StreamVideoLibrary` in `<cf/stream_video.hpp>` now provides `list` (operation416)
and `details` (417), returning owned ID, opaque state, reported ready flag, u64
byte size and optional duration in seconds (-1 means unknown). It excludes URLs,
arbitrary metadata, mutations and playback. IDs are1–128 ASCII alnum/underscore/
hyphen bytes; list limit1–50; state1–64 UTF-8 bytes; size a nonnegative JS safe
integer; duration finite and either nonnegative or-1. Local timeout1–60000ms.

Wire body is empty. List uses empty key and `count:timeout_ms` options; details
uses the video ID key and `timeout_ms`. Reply: LE u32 count followed by each
length-prefixed ID/state, u32 boolean, u64 size and f64 duration. Maximum11004
bytes. Both codecs reject malformed/bounded fields; details also checks ID equality.
The shared C++ UTF-8 helper preserves the existing AI Search validation contract.

Scoped acquisition promises, resolved scopes, pending reads and returned roots
stay owned through projection and are released when synchronous Symbol.dispose is
available. Abort/deadline disposes late handles without beginning a subsequent
read, observes late rejection and never disposes the borrowed binding. This does
not delete videos, stop native processing/billing or bound earlier native parsing,
provider buffers or blocked event-loop time.

The [C++/Wasm example](../examples/stream/README.md) reads real local simulator
metadata (**L**), including concurrent details, list and missing/deleted records.
A separate explicit mock tests malformed results, deadline and recovery (**M**).
Its local-only fixture setup uses the simulator's raw-stream extension; that is
not a C++ upload API or production format/upload evidence. The separate platform
audit uses the URL argument shape. Remote Stream config is refused before local
bundling. No account storage or delivery was used.

List is account-scoped, not tenant authorization; a live plan must not enumerate
unrelated account videos merely to exercise this method. Syntactically valid IDs
are not permission to read them. Upload, mutation, filters/pagination, captions,
downloads, watermarks, tokens and playback remain outside the C++ subset.

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
must be rechecked before any live probe. The initial audit executed no transformation;
the subsequent named live probe is recorded above.
That opt-in probe used an owned 448-byte animated GIF and authenticated
isolated ingress; at most three processing attempts, no transformation retries,
URL crawling, AI or account storage. Only a token hash is deployed. The private
token file was removed after verified cleanup; future probe tokens must remain
local and must not be printed in preparation/probe reports.
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

Quick Actions are a distinct boundary. The [current Quick Actions docs](https://developers.cloudflare.com/browser-run/quick-actions/)
require compatibility date2026-03-24 or later and explicitly say `quickAction` is
not supported in local development. The pinned local binding confirms
`The RPC receiver does not implement the method "quickAction"`. Provisioning
Chrome alone does not add that missing RPC method. Do not infer screenshot/PDF/
content support from the existence of local session routes.

A no-launch workerd test checks that rejection and reads only raw Fetcher session,
limits and history routes. It observes empty sessions before/after, hardcoded local
limits6/6/0 and empty history. Those synthetic values are not account allowance,
permissions, usage or cleanup proof. Pinned hashes of the Miniflare entrypoint and
Browser worker source gate the test before startup; dependency changes require
routing/launch review, not a blind hash refresh. It never acquires/connects a
browser, launches Chrome, downloads binaries or uses a personal profile.

The default example harness refuses browser configurations before bundling.
`lib/browser.mjs` now prototypes bounded HTML-only PNG through the documented
`quickAction('screenshot', options)` method. It snapshots1..65536 UTF-8 input bytes
before suspension, accepts1..512 viewport dimensions and1..60000ms local timeout,
and caps the returned PNG payload at1MiB. MIME/signature checks are not full PNG
decoding or dimension verification. It requests binary PNG, viewport scale1,
no full-page/beyond-viewport capture, JavaScript disabled, rejection of all request
URL patterns, cacheTTL0, bestAttempt false and explicit navigation/action timeouts.
There is no URL, cookie, arbitrary header, selector or backend-selection option.

Explicit mocks verify options, Unicode/BOM/NUL, bounds, ownership, errors and
cancellation. A separate real workerd service-RPC test returns a fixture Response:
its streamed body stays usable until consumed, owned promises are disposed once,
late calls are observed and the borrowed service remains callable. This is native
RPC transport/lifetime evidence with a **mock renderer**, not Browser rendering.
Conditional synchronous disposal retains owned promise/result roots through reads;
late response bodies are discarded. Cleanup failure rejects otherwise-successful
calls, preserves primary failures, and cannot change already-settled calls.

Forwarded options are not verified network isolation; byte/deadline caps cannot
bound native rendering memory, establish stopped billing or erase remote effects.
No native AbortSignal option is invented. No Browser C++ API, operation number or
runnable C++ Browser example is implemented yet.

Miniflare supports local browser sessions via raw Fetcher routes as well as remote proxy mode.
Typed session-method parity has not been verified. Its pinned
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
- [Quick Actions requirements](https://developers.cloudflare.com/browser-run/quick-actions/)
- [Screenshot endpoint and binding](https://developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/)
- [No-launch local Browser regression](../tests/browser-platform.test.mjs)
- [Default Browser policy](../tests/browser-policy.test.mjs)
- [Browser adapter prototype](../lib/browser.mjs), [boundary mocks](../tests/browser-adapter.test.mjs)
- [Native RPC Response lifetime with mock renderer](../tests/browser-rpc-lifetime.test.mjs)
- [Browser pricing](https://developers.cloudflare.com/browser-run/pricing/)
- Pinned Miniflare STREAM_PLUGIN, MEDIA_PLUGIN, BROWSER_RENDERING_PLUGIN,
  stream/binding.worker.js, ensureBrowserInstalled/launchBrowser and BROWSER_VERSION.
- [Local simulator regression](../tests/stream-platform.test.mjs).

A guessed media-transformations documentation index returned 404; the supported
Media documentation was located through Stream's documentation index instead.
That failed URL was not treated as evidence of missing platform support.
