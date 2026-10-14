# Bounded keyword search

`cf::AiSearch::keyword_search(AiSearchKeywordQuery)` uses a fixed direct-instance
binding and returns owned IDs, scores, source keys and text. Request keywords use
AND matching; rewrite, rerank, cache and context expansion are disabled. The
instance must have keyword indexing enabled. No automatic vector fallback, chat,
metadata, namespace selection, resource lifecycle or Agent Memory API is provided.

```sh
bazel test //:ai-search_local_test
bazel build //:ai-search_bundle
bazel run //:dev_example -- examples/ai-search/test/local.wrangler.jsonc
```

POST plain UTF-8 text to `/search`; `/short-timeout` demonstrates a local deadline.
GET `/` does not search. The response is human-readable tab-separated text, not a
safe interchange format for arbitrary fields. Use the typed C++ result in real
applications and treat source keys/text as untrusted data, not authorization.

The local configuration is an explicit provider mock with actual C++/Wasm dispatch
(**M**). It does not index, search, rank or contact Cloudflare. Production config
requires an approved existing keyword-enabled instance and is refused by the
local harness. Do not deploy it without approved synthetic data, current pricing,
authenticated ingress and independent resource cleanup planning.

Limits: query1–4096 UTF-8 bytes; requested results1–50; timeout1–60000ms. IDs1–256
bytes, source keys1–2048, text0–16384, finite scores0–1. The reply is at most935404
bytes. These are SDK subset caps, not provider acceptance or native parsing/heap
bounds. Local timeout/cancellation does not guarantee native cancellation, stopped
billing or rollback. Returned owned RPC roots/promises are disposed when supported;
the borrowed binding is never disposed. [Scope and evidence](../../docs/search-readiness.md).
