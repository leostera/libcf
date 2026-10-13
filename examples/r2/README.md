# R2 binary objects from C++

```sh
npm ci
npm run test:r2
npm run build:r2
node scripts/dev-example.mjs r2
```

`cf::R2Bucket` exposes get/head/put/erase/list. Metadata is typed (key, size, ETag, HTTP ETag and content type); binary bodies are not decoded as text. The example provides `PUT/GET/HEAD/DELETE /objects/:key` and `GET /list` for the `listed-` prefix. A GET with `x-offset` demonstrates a two-byte range (this is a demo control, not standard HTTP Range handling).

Four local integration tests cover binary and empty values, metadata/ETags, missing objects, ranged reads, invalid offsets, deletion and paginated listing. Native tests reject malformed metadata wire replies. Deletion returns a successful `Unit`, not a boolean claiming that the object existed.

Limits and gaps: this first slice buffers bodies (1 MiB limit); results are limited to 4 MiB. Streaming bodies, multipart uploads, conditional operations, suffix ranges, custom metadata, checksums, upload timestamps, SSE-C, storage classes and delimiter listings remain unimplemented. These limits are libcf constraints, not R2 constraints. An isolated private-bucket live probe verified binary CRUD, metadata/ETag, HEAD, ranges, invalid offsets, empty/missing values and prefix pagination; see [evidence and cleanup](../../docs/live-verification.md). The checked-in bucket config remains local-only.

Sources: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [multipart usage](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/).
