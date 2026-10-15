# Legacy Sites reads

```sh
bazel build //:legacy-sites
bazel test //:legacy-sites_local_test
```

`cf::LegacySites::get_bytes()` reads exact logical names through a trusted immutable manifest. Import `__STATIC_CONTENT_MANIFEST` and pass its text as `createWorker(..., { sitesManifest })`; the default namespace is `__STATIC_CONTENT`. Missing or malformed manifests fail rather than falling back to raw KV.

POST a literal filename to `/read` (default index.txt). Missing mapping/data returns 404; present empty data returns 200. Output is owned bytes capped at 1 MiB. There is no URL decoding, directory fallback, MIME guessing, caching, range support, or write/list API. Never accept client-supplied manifest mappings.

The dedicated local test supplies a native manifest/namespace and temporary files. Automatic cf CLI upload/synchronization is not established. New applications should generally prefer Static Assets.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
