# Stream video metadata

```sh
bazel build //:stream_bundle
bazel test //:stream_local_test
```

`cf::StreamVideoLibrary::list(StreamVideoListRequest)` returns a bounded first page; `details(StreamVideoDetailsRequest)` reads one video's metadata. Results own ID, state, reported ready flag, size, and optional duration. Ready is a provider report, not playback/decoding validation.

GET `/videos` lists; POST an ID to `/details`. IDs are 1–128 ASCII alphanumeric/underscore/hyphen bytes; list limit 1–50 (default 10), timeout 1–60000 ms (default 5000). Size must be a nonnegative JS-safe integer; duration is nonnegative or unknown. The reply is capped at 11004 bytes.

Local tests use the native Stream simulator plus separate malformed-result mocks. Synthetic upload/removal helpers are local fixtures, not public C++ APIs or production transcoding evidence. No upload, mutation, filters, arbitrary metadata, playback, or token APIs are exposed.

Listing is account-scoped, not tenant authorization. Protect endpoints and use only owned data. Disposal does not delete videos or stop billing. Do not activate subscriptions or storage implicitly.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md).
