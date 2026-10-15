# Keyword search

```sh
bazel build //:ai-search
bazel test //:ai-search_local_test
```

`cf::AiSearch::keyword_search(AiSearchKeywordQuery)` returns owned IDs, scores, source keys, and text from a fixed keyword-enabled instance. Matching uses AND; rewrite, rerank, cache, and context expansion are disabled. POST UTF-8 text to `/search`.

Query size is 1–4096 bytes, result limit 1–50, timeout 1–60000 ms. Returned IDs are up to 256 bytes, source keys 2048, text 16384, with finite scores 0–1. Projection caps do not bound prior native allocation. Treat results as untrusted data, not authorization. No vector fallback, chat, metadata, namespace selection, or lifecycle APIs are provided.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
