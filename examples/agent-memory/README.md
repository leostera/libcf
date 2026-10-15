# Agent Memory listing

```sh
bazel build //:agent-memory
bazel test //:agent-memory_local_test
```

`cf::AgentMemory::list_memories(GetOrCreateMemoryProfile, options)` returns owned memory metadata and an optional cursor. **Profile lookup creates missing profiles**, even if listing later fails. Disposal is not profile deletion; there is no existing-only lookup.

POST an optional cursor to `/list`; the fixture selects a fixed profile. Caps: profile 1–100 ASCII alnum/_/-, count 1–50, cursor up to 2048 UTF-8 bytes, timeout 1–60000 ms. Results contain IDs, types, summaries, sessions, and timestamps—not content, recall, generation, ingestion, or deletion. Pagination is not a stable snapshot. Protect profile access and do not use creating lookups to verify cleanup.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
