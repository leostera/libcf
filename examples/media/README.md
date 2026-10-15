# First-frame media extraction

```sh
bazel build //:media
bazel test //:media_local_test
```

`cf::Media::frame_png(MediaFrameRequest)` requests time 0s as PNG with contain fit. Input/output caps are 1 MiB; dimensions are 10–512 (default 128×128); timeout is 1–60000 ms (default 5000). Status, MIME, and PNG signature are checked, not full pixel decoding.

POST video bytes to `/frame`. The route fails closed unless `LIBCF_MEDIA_PROBE_SHA256` is configured and a 256-bit bearer token matches its hash. Never print, commit, or put that token in a URL. Local tests use a fixed-image mock, not a video decoder. Native format support must not be inferred from it.

Cleanup is best effort and does not stop provider work/billing. No timestamp selection, clips, audio, sprites, or other output formats are exposed. Native use needs an approved processing budget and owned input.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
