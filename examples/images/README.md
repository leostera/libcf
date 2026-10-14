# Images metadata and bounded PNG rotation from C++

```sh
bazel build //:images
bazel test //:images_local_test
```

Included in the default suite. Header: `<cf/images.hpp>`.

```cpp
cf::Images images(context.bindings, "IMAGES");
auto info = co_await images.info(owned_bytes);
auto rotated = co_await images.rotate_png90(owned_bytes,
    cf::ImageRotateOptions{std::chrono::milliseconds(5000)});
```

## Metadata

`info(Bytes)` returns `AsyncResult<ImageInfo>` for1–1048576 input bytes:
`SvgImageInfo` or `RasterImageInfo` with media type, file size, width and height.
`POST /info` accepts bytes; `/missing` and `/oversized` are failure fixtures.
Metadata is not a sanitizer or proof that every decoder will accept the image.

## Rotation subset

`rotate_png90(std::span<const std::uint8_t>, options)` returns owned PNG `Bytes`.
It performs one clockwise90-degree rotation, with PNG output and `anim:false`.
Input/output≤1MiB, declared dimensions1–1024 per axis,8-bit RGB/RGBA only,
interlace0/1. Up to1024 chunks; APNG frames/control chunks, unsupported critical
chunks, bad framing, trailing bytes and unsupported headers reject. The output
must have swapped dimensions. Framing checks do **not** validate CRCs or decode
pixels; ancillary metadata is forwarded, and provider decode memory/work is not
bounded by these projection limits.

Input is validated before bounded copying; input/options/binding and expected
output dimensions are snapshotted before suspension. No borrowed input span or
client object survives in the completion callback. Timeouts1–60000ms default5000.
The JS adapter retains roots through output consumption, deduplicates alias
cleanup, cancels late/unconsumed streams best-effort and preserves primary errors.
A local timeout does not establish stopped provider work or billing. No retries.

The isolated test fixture enables `POST /rotate`, `/rotate-missing` and
`/rotate-oversized` with a trusted environment flag. Successful output uses
`image/png` and `nosniff`; failures return generic502 `image rotation failed`.
**The default example entry disables all `/rotate*` routes with403.** Existing
metadata-only live preparation does not enable them. Do not deploy the local
fixture flag as authorization: a live rotation example needs a separately approved
cost/resource plan and an authenticated entrypoint.

## Evidence and remaining scope

The harness executes the emitted Bazel bundle against the native local Images
binding, not a freshly rebundled entry. It verifies metadata, independently decoded
rotation pixels, exact1MiB input,8 concurrent pixel-correct rotations, negative
cases, recovery and the default-disabled route. Native C++ tests cover input/reply
framing and bounds, ownership/snapshots and error kinds. JS tests cover provider
receivers, aliases, pending/body lifetimes, malformed output and cancellation.
The local simulator is Sharp-backed and is not production decoder parity.

Historical live verification covered **metadata only**: PNG dimensions/size, SVG
category, invalid/empty/missing/oversized failures and recovery, with Worker/DNS/
certificate cleanup. No live transformation or hosted upload was performed.
See [live evidence](../../docs/live-verification.md). Existing metadata-only opt-in
workflow: `bazel run //:prepare_live_worker -- images`, establish ownership and
cleanup for the generated Worker/hostname, then `cf deploy --prebuilt` and
`bazel run //:live_images -- <host>`. Reruns remain approval-gated; `.info()` is
documented free, while transforms have separate billing.

Other angles, resize/drawing, text/fonts, other formats, hosted C++ CRUD/direct
upload, caching and native error-code preservation remain open. The separate
[readiness audit](../../docs/images-readiness.md) records native-local hosted
feasibility and the paid-plan/live gates. No account operation occurs in defaults.
