# Agent Memory list

`cf::AgentMemory::list_memories(GetOrCreateMemoryProfile, AgentMemoryListOptions)`
returns an owned `AgentMemoryPage` with enum types, optional cursor/session strings,
and `chrono::sys_time<milliseconds>` timestamps. The required profile selector is
explicitly **get-or-create**: the underlying `getProfile()` creates missing profiles,
even if a subsequent list fails or times out. This is not an existence check or
application authorization. There is no existing-only mode or automatic deletion.

```sh
bazel test //:agent-memory_local_test
bazel build //:agent-memory_bundle
```

The local example executes real C++/Wasm with an **explicit fake provider**, not
native Agent Memory storage or AI. No account, namespace or profile is accessed.
The production config is refused by the default local harness. Compatibility date
2026-10-13 matches the pinned workerd runtime.

POST `/list` with an optional opaque UTF-8 cursor body; empty body requests the first
page. The example selects the fixed `libcf-owned-example` profile, not an arbitrary
caller-supplied tenant. In the mock, the first response gives cursor `page-2`; sending
that cursor yields an empty terminal page. Eight concurrent requests and Unicode,
BOM/NUL, signed timestamps, nullable/empty sessions, input/output bounds and recovery
are tested. `/maximum` with body `maximum` exercises the maximum wire result.
`/missing`, `/invalid-profile` and `/short-timeout` exercise failure paths.

Output is human-readable tab-separated text, **not delimiter-safe interchange**.
Type numbers0..3 mean fact/event/instruction/task. Timestamps are signed epoch
milliseconds; null sessions display `null`, present sessions display `value:...`.
The mock understands `fail`, `bad-date`, `bad-type`, `oversized`, `bad-cursor`,
`cleanup-fail` and `slow` cursor markers; they are not real provider cursors.

SDK caps: profile1..100 ASCII alnum/_/-, count1..50, cursor1..2048 UTF-8 bytes when
present, timeout1..60000ms. Projected ID1..128 bytes, summary0..4096, nullable session
0..64; valid Date milliseconds within ±8640000000000000. Maximum wire218260 bytes.
No content, arbitrary metadata, recall, generation, ingestion or deletion API is
exposed. Native materialization precedes projection caps; timers are cooperative.
Disposal releases RPC leases, not persistent profiles. Cancellation cannot establish
rollback, stopped work/billing or erasure. Profiles can be recreated between pages;
no stable pagination snapshot is promised.

Do not expose this unauthenticated example publicly or point it at existing data.
Native verification requires approved synthetic data/access, an isolated owned
namespace/profile, current pricing, authenticated ingress and non-creating cleanup
readbacks. Private-beta nonbilling is not permission; never call `getProfile()` to
verify deletion. See [readiness](../../docs/search-readiness.md).
