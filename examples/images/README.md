# Images metadata from C++

```sh
npm ci
node scripts/build-worker.mjs examples/images/wrangler.jsonc
node --test examples/images/test/*.test.mjs
```

Included in the default suite. `cf::Images(context.bindings, "IMAGES").info(owned_bytes)` returns `AsyncResult<cf::ImageInfo>` for 1–1,048,576 input bytes.

The result is `std::variant<SvgImageInfo, RasterImageInfo>`. SVG reports its category only; the SDK does not invent pixel dimensions for a format whose native metadata result omits them. Raster metadata owns its media type, byte size, width and height. Numeric fields are positive uint32 values, file size is within the input cap, and media types are bounded lowercase `image/` values. Both JS and C++ check the tagged, bounded little-endian result.

The JS adapter copies the input view into a Blob before awaiting the native `info(stream)` call. It cancels an unlocked input stream on completion/failure. Already-started provider work is not promised to stop on request cancellation; stale completions cannot resume a removed C++ invocation. Metadata inspection is **not** a full decode, rendering guarantee, SVG sanitizer or untrusted-upload security policy.

Two workerd cases use the real pinned local Images binding (Sharp-backed): a generated 2×3 PNG with exact byte-size readback, SVG categorization, invalid/empty images, missing binding, SDK overflow and recovery. Direct adapter tests cover owned bytes, golden metadata wire, malformed results and stream cleanup; native tests cover variant decoding and bounds. The local implementation is a lower-fidelity emulator, not proof of production decoder parity.

`POST /info` accepts bytes; `/missing` and `/oversized` are failure fixtures. No upload or hosted image is created. For an opt-in live probe, build the example, run `node scripts/build-live-worker.mjs images`, establish ownership of the generated Worker/hostname, deploy with `cf deploy --prebuilt` from `build/live-images`, then run `LIBCF_LIVE_READY_TIMEOUT_MS=2400000 node scripts/test-live-images.mjs <host>`. Verify Worker, DNS and certificate cleanup afterwards. Live PNG dimensions/size, SVG category, invalid/empty/missing/oversized failures and recovery passed; Worker/DNS/certificate cleanup is verified. See [live evidence](../../docs/live-verification.md). This does not establish decoder parity for other formats or make metadata inspection a sanitizer. Current documentation says `.info()` calls are free; transformations have separate billing, and no transformation was invoked.

Not implemented: input options, transformations/drawing, text rasterization, hosted-image CRUD, direct upload, caching policy or native Images error-code preservation. Provider failures remain SDK errors rather than metadata values.

Sources retrieved 2026-10-13: [Images binding](https://developers.cloudflare.com/images/optimization/binding/) and its local-development/billing notes; pinned Worker types and Miniflare `imagesLocalFetcher`/`runInfo` implementation.
