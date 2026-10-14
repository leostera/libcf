# AI Search and Agent Memory readiness

Audit date2026-10-14. No C++ search/memory API, managed-index experiment or profile
operation is implemented/verified here. This audit separates native Worker APIs,
local policy checks and future provider evidence.

## Worker-accessible scope

AI Search has direct-instance (`ai_search`) and namespace (`ai_search_namespaces`)
bindings. A namespace supports get/list/create/delete and multi-instance search/
chat; an instance supports search/chat, configuration/info/stats, items and jobs.
These binding operations remain in libcf's Worker-accessible scope even when they
create resources; they must not be dismissed as dashboard-only REST administration.
A direct-instance search is a smaller initial surface than exposing all lifecycle
and multi-instance operations at once.

`search` retrieves scored chunks; `chatCompletions` generates an answer and can
return an SSE stream. The binding's text-only input note conflicts with a generic
parameter table that describes image/file parts; installed types also distinguish
the binding from REST. Start with plain query/text inputs, not inferred multimodal
parity. Result count is1–50; context expansion can add surrounding chunks. Explicit
options must control rewriting/reranking rather than silently introducing extra AI
work. Instance/profile selection must be authorized, not derived blindly from a
user-supplied name. User-visible type declarations are not byte/lifetime guarantees.

Agent Memory exposes namespace getProfile/deleteProfile and profile remember,
ingest, recall, get/list/delete, deleteSession and getSummary. **getProfile creates
an absent profile**; it is not a read-only existence check. Remember classifies and
summarizes, ingest extracts memories, recall synthesizes an answer and getSummary
generates a summary. Recall is not merely returning stored bytes.

Memory records contain Date values, and profile/instance access may involve service
handles. Do not route these through generic JSON serialization without an explicit
projection/lifetime policy. libcf's JSON encoder deliberately rejects Date/toJSON
and unsupported capabilities. Inspect/dispose native returned handles/promises as
appropriate; a plain-object mock alone cannot establish those semantics. Limits
on owned results cannot bound provider-side processing or earlier materialization.

## Local behavior and source disagreements

Pinned Miniflare5.20261006.1-alpha maps AI Search's two binding types and Agent
Memory to remote proxy services. The local harness rejects all three config keys
before bundling/runtime startup. These refusal tests are not C++ integration or
provider evidence; future explicit mocks must be M, not native local L/V.

Agent Memory documents recall queries at1024 UTF-8 bytes, ingest messages at32768
UTF-8 bytes and500 messages per call; an SDK should also impose an aggregate byte
budget. Profile/session/namespace names are limited in characters (100/64/32),
not automatically the same as UTF-8 bytes. The limits page says list size up to1000,
while the Workers API page and installed types say500. Use a conservative subset
until the provider boundary is verified; do not pick the larger number silently.

## Pricing and cleanup must be current

AI Search's October1 pricing page says billing begins **November1,2026**. Included
monthly usage is5M ingestion tokens,10GB-month storage and1000 each semantic/full-
text queries; later overages are$0.75/M ingestion tokens,$2/GB-month,$0.75/1000
semantic queries and$0.10/1000 full-text queries (image processing adds cost).
Workers AI embedding/reranking and managed storage/vector indexing are included in
AI Search usage; generation, rewriting and external providers remain separately
billed/logged. Do not carry forward the old assumption that all embedding work
appears on a separate Workers AI bill, or assume future billing has already begun.
Historical crawler R2 buckets can retain separately billed objects; they are not
ours to remove.

Agent Memory's pricing page says no billing during **private beta**, with30 days
notice before changes. That does not establish this account's access or authorize
persistent user data. Account access/usage have not been probed. A future live
plan must use fixed synthetic data, current pricing/access confirmation, bounded
approved work, authenticated ingress and exclusive resource ownership.

Profile/session deletion marks data for deletion; acknowledgement is not physical
erasure. Never verify deletion by calling getProfile, which can recreate the
resource. Search-instance creation/upload acknowledgements likewise do not prove
indexing or retrieval visibility. Plan independent, non-creating cleanup readbacks
before provisioning; do not touch existing default-namespace contents.

## Sources

- [Search binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)
- [Instance binding operations](https://developers.cloudflare.com/ai-search/api/instances/workers-binding/)
- [AI Search limits/pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- [Agent Memory Workers API](https://developers.cloudflare.com/agent-memory/api/workers-api/)
- [Memory limits](https://developers.cloudflare.com/agent-memory/platform/limits/)
- [Memory pricing](https://developers.cloudflare.com/agent-memory/platform/pricing/)
- Pinned Miniflare `AI_SEARCH_PLUGIN` / `AGENT_MEMORY_PLUGIN`; newer installed
  Workers types5.20261010.1 cross-checked separately from workerd1.20261006.1.
