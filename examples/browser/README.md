# Browser HTML screenshot

`cf::BrowserRun::screenshot_html_png` sends bounded UTF-8 HTML through the documented
Browser Run Quick Action and returns owned binary PNG bytes. The example accepts
POST `/screenshot`; GET `/` is a non-rendering health response.

```sh
bazel test //:browser_local_test
bazel build //:browser_bundle
```

The local test executes actual C++/Wasm with an **explicit mock renderer**. It
returns a fixed existing PNG fixture, not rendered HTML or requested dimensions.
There is no browser binding, Chrome download, personal profile or account access.
The production config is intentionally rejected by the default local harness.
Quick Actions are unsupported in the pinned native local Browser binding; simply
installing Chrome does not enable them. Compatibility date2026-10-13 matches the
pinned runtime's newest supported date (2026-10-14 is rejected by that binary).

The SDK accepts1..65536 UTF-8 bytes, viewport dimensions1..512 and local timeout
1..60000ms. It fixes PNG/binary, viewport scale1, no full-page/beyond-viewport
capture, JavaScript disabled, rejection of all request URL patterns, cacheTTL0,
bestAttempt false, and explicit navigation/action timeouts. Output is capped at
1MiB with MIME/signature validation, not full PNG decoding/dimension/pixel checks.
No URL/cookie/header/selector/backend-selection or session-automation API is exposed.

Forwarded options are not verified isolation or HTML sanitization. Limits do not
bound native renderer memory; deadline/disposal do not establish stopped work,
stopped billing, rollback or erasure. The mock's `slow`, `fail`, `bad-status`,
`bad-mime`, `bad-signature` and `oversized` bodies exercise failures. `/missing`,
`/invalid-size` and `/short-timeout` exercise other boundary paths.

Do not publicly expose this unauthenticated example as a rendering service.
Native verification needs an approved usage/data/cleanup plan, authenticated
bounded ingress and owned synthetic HTML. No deployment or live rendering is
claimed. See [readiness and limits](../../docs/media-readiness.md).
