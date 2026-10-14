# Media first-frame PNG

```sh
bazel build //:media_bundle
bazel test //:media_local_test //:native_media_test //:js_media-adapter_test
```

`cf::Media::frame_png(MediaFrameRequest)` extracts time `0s` as PNG with contain
fit. POST owned video bytes to `/frame`; GET `/` performs no transformation.
Input/output caps are 1 MiB, dimensions 10–512 (default 128×128), and the local
wait is 1–60000 ms (default 5000). No timestamp, format, clip, audio or sprite API.

Local tests run actual C++/Wasm against an **explicit mock** returning a fixed 2×3
PNG. They are M evidence, not video decoding, resizing or native Media coverage.
Production config is rejected by the local helper. No live transformation has
been verified. Do not make this unrestricted transformation endpoint public.

The adapter calls one single-use input/transform/output/response chain, checks
status/MIME and PNG signature and returns owned bytes. It does not decode PNG or
verify actual dimensions. It bounds SDK consumption, not upstream native buffers
or codec memory. Deadline/cancellation are cooperative local termination with
best-effort input/late-response cleanup, not stopped remote work or rollback.
Builders stay request-local; the borrowed environment binding is never disposed.

See [readiness and current billing](../../docs/media-readiness.md). Live testing
requires a bounded owned video fixture, authenticated ingress, a current pricing
check, explicit resource ownership and independently verified cleanup.
