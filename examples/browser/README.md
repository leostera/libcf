# HTML screenshot

```sh
bazel build //:browser
bazel test //:browser_local_test
```

`cf::BrowserRun::screenshot_html_png` sends 1–65536 UTF-8 bytes of HTML and returns up to 1 MiB of PNG bytes. POST HTML to `/screenshot`. Viewport dimensions are 1–512 and timeout 1–60000 ms.

The adapter requests JavaScript disabled, all request URLs rejected, no full-page capture, scale 1, cacheTTL 0, and explicit action/navigation deadlines. These options are not verified isolation or HTML sanitization. Output MIME/signature checks are not pixel/dimension validation. Quick Actions are unavailable in the pinned local native browser binding; installing Chrome does not supply them. Protect rendering ingress and budget usage. URL browsing, cookies, sessions, and automation are not exposed.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
