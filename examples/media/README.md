# Media first-frame PNG

```sh
bazel build //:media_bundle
bazel test //:media_local_test //:native_media_test //:js_media-adapter_test
```

`cf::Media::frame_png(MediaFrameRequest)` extracts time `0s` as PNG with contain
fit. Authenticated POSTs send owned video bytes to `/frame`; GET `/` performs no transformation.
Input/output caps are 1 MiB, dimensions 10–512 (default 128×128), and the local
wait is 1–60000 ms (default 5000). No timestamp, format, clip, audio or sprite API.

Local tests run actual C++/Wasm against an **explicit mock** returning a fixed 2×3
PNG. They are M evidence, not video decoding, resizing or native Media coverage.
Production config is rejected by the local helper. A [clean-source native probe](../../docs/live/bazel-media-2026-10-14.json)
passed the named synthetic-GIF subset, including PNG MIME/signature and 128×128
IHDR, authentication, failures/recovery and independent resource cleanup.
The example fails closed without `LIBCF_MEDIA_PROBE_SHA256` and
requires a 256-bit bearer token whose SHA-256 matches that configured hash. It
uses native timing-safe comparison before SDK body consumption or provider invocation.
The fixed test credentials exist only in the explicit local mock.

The adapter calls one single-use input/transform/output/response chain, checks
status/MIME and PNG signature and returns owned bytes. It does not decode PNG or
verify actual dimensions. It bounds SDK consumption, not upstream native buffers
or codec memory. Deadline/cancellation are cooperative local termination with
best-effort input/late-response cleanup, not stopped remote work or rollback.
Builders stay request-local; the borrowed environment binding is never disposed.

## Opt-in live preparation

```sh
bazel run //:prepare_live_worker -- media
# After ownership checks and an isolated cf CLI deployment:
LIBCF_MEDIA_PROBE_TOKEN_FILE=/absolute/path/to/build/live-media/probe-token \
  bazel run //:live_media -- libcf-media-XXXXXXXXXX.libcf.leostera.dev
```

Preparation creates a fresh private mode-0600 token file; only its hash enters the
deployment. Never print, commit or pass the token in a URL. The builder deploys
nothing. The probe allows at most three Media processing attempts and never
retries transformations. TLS readiness and invalid-auth checks do no processing.

The owned fixture is a deterministic 448-byte animated GIF: two 16×16 frames,
red then blue, 100ms each. No host encoder, download, account object or third-party
footage is needed. A separate pinned local Images/Sharp test decodes it; that is
not a local Media emulator. The live probe checks PNG headers/dimensions, not
pixel colors, full PNG decoding, MP4 support or remote cancellation.

See [readiness and current billing](../../docs/media-readiness.md). Live testing
still needs a current pricing check, explicit ownership and independently
verified cleanup. Do not enable subscriptions or mutate zone transformation
settings as part of this probe. Remove the owned private token after independently
verifying resource cleanup; retain the non-secret ownership/evidence records.
