# Legacy Sites manifest reads

```sh
bazel test //:legacy-sites_local_test
bazel build //:legacy-sites_bundle
```

A native local C++/Wasm vertical for `cf::LegacySites::get_bytes()`, not a full
asset server. The dedicated test executes the emitted Bazel bundle with a real
Miniflare Sites manifest/namespace and only owned temporary files. Ordinary
fixture helpers reject `site` instead of silently ignoring it.

The Worker imports `__STATIC_CONTENT_MANIFEST` and passes its trusted text to
`createWorker(..., { sitesManifest })`, parsed once. Bundle schema2 records this
required text module; it is not fabricated or included by the bundler. A missing
or malformed manifest is a configuration error, not a raw-KV fallback. Never
accept manifest mappings from clients. Default namespace is `__STATIC_CONTENT`;
an explicit alternate namespace is possible but does not grant access authority.

GET `/` is health. POST `/read` with a literal logical filename (default
`index.txt`) returns owned binary bytes with `application/octet-stream` and
`nosniff`; absent mapping/data returns404, present empty data returns200.
POST `/missing-binding` exercises an unavailable namespace. Errors are generic502.
There is no URL decoding, directory/index fallback, MIME guessing, cache/ETag,
HEAD/range/conditional logic, list/write API or automatic retry.

See [Sites readiness](../../docs/sites-readiness.md) for exact manifest/path and
1MiB output limits, native-local versus production distinctions, cooperative
deadline/cancellation limitations and remaining deployment work. Native producer
work/buffers/billing are not bounded by the output projection. The configuration
file is a guarded placeholder, not deployment authorization. cf CLI automatic
Sites upload is unverified; no account/upload/certificate/network operations occur
in these tests. Production hashes, caching, consistency and live verification remain
open. New applications should generally use modern Static Assets instead.
