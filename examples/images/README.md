# Images metadata and PNG rotation

```sh
bazel build //:images
bazel test //:images_local_test
```

`cf::Images::info(bytes)` returns SVG or raster metadata for 1–1048576 input bytes. Metadata is not sanitization. `rotate_png90(bytes, options)` performs one clockwise 90-degree rotation into PNG; it supports 8-bit RGB/RGBA PNG, dimensions 1–1024, and input/output up to 1 MiB. APNG and unsupported headers/chunks are rejected.

Timeout is 1–60000 ms, default 5000. Framing checks do not validate CRCs or decode pixels and do not bound provider decoder memory. The local Sharp-backed provider is not production decoder parity.

POST bytes to `/info`. All `/rotate*` routes are disabled by default (403); only the dedicated local fixture enables them. Do not treat that flag as authentication or usage approval. Other transforms/formats, hosted CRUD/direct upload, and caching are not exposed. Rotation has not been live-provider verified.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
