# Read-only Stream video metadata

`cf::StreamVideoLibrary` in `<cf/stream_video.hpp>` provides:

- `list(StreamVideoListRequest)`: a bounded first page of owned metadata.
- `details(StreamVideoDetailsRequest)`: one ID's owned metadata, or an error.

`StreamVideoInfo` contains ID, opaque state, reported ready flag, byte size and
optional `std::chrono::duration<double>` (seconds). Native duration-1 is unknown;
ready is a provider report, not a decoder/playback check. No URLs, arbitrary
metadata, tokens, uploads, mutation, pagination filters or playback are exposed.

```sh
bazel test //:stream_local_test
bazel build //:stream_bundle
bazel run //:dev_example -- examples/stream/test/local.wrangler.jsonc
```

GET `/videos` lists the local page; POST an ID as plain text to `/details`.
GET `/` does not read metadata. `/short-timeout` uses a20ms local deadline.
Output is human-readable tab-separated text, not a delimiter-safe interchange
format. Use the typed C++ result in applications.

The test configuration uses the real local Stream simulator with C++/Wasm (**L**).
POST `/__fixture` seeds an owned synthetic GIF using a **local-only raw-stream
upload extension**; `/__remove` removes only IDs created by that fixture helper.
Those routes are absent from the production entrypoint. This setup is not a C++
upload API, production GIF acceptance or transcoding proof. A separate platform
test uses the published URL argument shape with an owned loopback source. The
simulator reports ready with unknown duration/zero dimensions. An explicit mock
configuration separately exercises malformed replies and deadlines (**M**).

IDs are1–128 ASCII alphanumeric/underscore/hyphen bytes. List limit1–50, timeout
1–60000ms; defaults10 and5000. State is1–64 UTF-8 bytes. Size must be a nonnegative
JS safe integer; duration finite and either nonnegative or-1. Maximum reply11004
bytes. Acquired scopes/promises/results are released when they expose synchronous
Symbol.dispose; the borrowed binding is never disposed. Local cancellation drains
late handles without starting a subsequent read. It does not stop native work or
billing, bound native parsing/heap usage, or delete video resources.

**List is account-scoped, not tenant authorization.** ID syntax is not access
control. Protect real endpoints and do not enumerate unrelated account videos for
verification. No live subscription, storage or delivery was used. Never activate
Stream or buy prepaid storage implicitly. Live checks need current approval,
owned resources, authenticated ingress and independent cleanup planning. Remote
Stream configurations are rejected before local bundling.

[Scope, simulator limitations and pricing](../../docs/media-readiness.md).
