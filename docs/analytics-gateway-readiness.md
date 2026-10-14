# Analytics SQL and AI Gateway readiness

Audited2026-10-14 against Miniflare5.20261006.1-alpha/workerd1.20261006.1 and
current public docs. P11 remains unimplemented in libcf: no dedicated C++ API,
operation or example. This audit makes no account query, model/provider call,
gateway/log lookup, mutation or credential request.

## Analytics SQL is not Analytics Engine writeDataPoint

The `analytics` Worker binding supplies `query({query, params?})` against datasets
in the Worker's owning account. It is not the `analytics_engine_datasets` write
binding, D1 SQLite, Durable Object SQL, or the older Analytics Engine HTTP endpoint
`/accounts/{account}/analytics_engine/sql`. The newer SQL API has a separate
language and account/zone scope rules. Existing libcf Analytics Engine write
acceptance does not establish query support, storage or retention.

The current binding contract is narrower than the general REST API:

- One SELECT statement, optional positional or named parameters whose values are
  strings, numbers, booleans or null. SQL statement limit10KiB, parser depth10,
  one dataset and account per statement; lower timestamp bound required.
- The Worker account supplies scope. Do not insert accountTag/zoneTag tenancy
  predicates or a request `scope`; the binding rejects tenancy in SQL and does
  not accept REST request-level `time_range`. Put time constraints in SQL.
- Only account-scoped datasets. Analytics Engine datasets can be queried as
  `events.analyticsEngine.<name>` subject to entitlement, quoting names that are
  not ordinary SQL identifiers. Do not use arbitrary user names as SQL fragments.
- Default ClickHouse-backed result: data rows, row count and statistics
  elapsed_ms/rows_read/bytes_read. No FORMAT clause. Log Explorer-backed datasets
  have another shape and are currently unsupported through the binding.
- No automatic retry; thrown errors can carry boolean `retryable`. That is not a
  retry instruction without a bounded budget. Do not replace a failed query with
  an empty successful result or retry all errors.

Dataset availability, fields, retention, row limits and execution resources depend
on plan and dataset. Explicit LIMIT can be rejected if above a dataset cap; the
API does not add a LIMIT just because one was omitted. LIMIT/output caps are not
scan-cost or data-access bounds. Read-only SQL can still expose unrelated account
traffic, identities, prompts or secrets. Parameterization prevents some injection
patterns; it does not authorize datasets/columns/time windows. Do not expose an
unauthenticated arbitrary-SQL endpoint, enumerate datasets or query account logs
as an implementation smoke test. Account access and billing/retention approval
remain prerequisites, including for existing Analytics Engine data.

A first bridge should bound query/parameter bytes and counts, preserve positional
versus named parameters and null/boolean/number/string values, and cap selected
result rows/columns/depth/aggregate bytes. Do not claim a regex validates the SQL
language, that JSON numbers preserve arbitrary64-bit integers, or that caps prevent
native result materialization. Distinguish owned response projection, execution
statistics and provider errors. Start with a fixed synthetic fixture query and
mock rows, not D1 masquerading as Analytics SQL. Native verification needs an
explicit owned dataset/time window/column list and consent to its retention and
query resource costs; a deadline does not prove the scan stopped.

## AI Gateway uses the AI binding, with different operations

`env.AI.run(model, inputs, {gateway: {id, ...}})` routes inference through a gateway.
`env.AI.gateway(id)` exposes getUrl/getLog/patchLog; installed types and pinned
source also retain legacy universal `run()`. The current docs recommend the newer
AI binding inference path and label the universal endpoint deprecated. Existing
libcf AI JSON mocks do not implement Gateway options or establish provider billing,
logging, caches, fallback routing, authentication or log access.

These operations have different risks:

- `getUrl()` returns an endpoint string, **but is not local string construction**:
  the pinned default implementation issues a GET through its bound fetcher to
  the Gateway backend. Do not invoke it against a real binding as harmless local
  discovery. Returning a URL does not authorize fetching it or attaching keys.
- `getLog()` reads potentially sensitive prompt/response/metadata; it needs
  explicit ownership and data permission. Native source converts created_at to
  Date. A future metadata projection should avoid raw payloads by default.
- `patchLog()` mutates feedback/score/metadata. It is not an annotation in a local
  object; no implicit feedback, rollback or retry should occur.
- Inference/run can incur provider charges, persistent logs and cache retention.
  The special gateway ID `default` can auto-create a gateway on the first
  authenticated inference request. Do not use it as an implicit test resource.
- `aiGatewayLogId` describes the most recent run; do not treat shared last-call
  state as a reliable per-request correlation handle under concurrency.

The pinned `AI.gateway()` implementation selects a remote RPC path with beta or
experimental settings; otherwise it constructs the JS facade over the remote
fetcher. Its source explicitly notes AbortSignal limitations on the RPC path.
Do not silently opt into beta/experimental behavior or claim that cancellation
stops provider work/billing. The legacy run implementation normalizes/mutates
request header values; a future bridge must own bounded request data before
calling it, rather than leaking mutation into caller-owned options.

### Gateway privacy and cost gates

Core Gateway features are published as free on all plans, not provider inference.
Logs are enabled by default and may include prompts/responses. New customers
whose first gateway is created on/after2026-09-24 use Workers Logs pricing and
retention; older customers use legacy logging rules. Do not assume legacy free
storage quotas apply to a new probe. Suppressing payloads still retains metadata;
logging flags are not proof of erasure or absence in upstream provider logs.

Guardrails use billed Workers AI inference. Unified Billing adds a5% credit
purchase fee; provider inference rates still apply. No balance, customer cohort,
plan or entitlement was checked, and no credit purchase is authorized here.
An approved native plan must fix provider/model, synthetic input/output limits,
retry/fallback/cache/log behavior, owned gateway/log IDs, credentials, spend bound
and independent cleanup/retention checks. Gateway authentication and provider
credentials are separate concerns; neither belongs in logs or example responses.

## Local runtime and policy

Pinned Analytics SQL installs a remote-proxy service; no local SQL simulator is
provided. AI installs the internal AI facade backed by a remote-proxy fetcher.
Neither permits relabeling ordinary fake RPC as native provider verification.
The fixture harness now rejects explicit `analytics` and `ai` fields before
bundling the affected worker, including null/false/remote:false and additional
configs. The existing local Analytics Engine write fixture remains allowed;
it is a separate no-op acceptance test. `tests/analytics-gateway-policy.test.mjs`
checks rejection order only, not isolation of arbitrary code.

Next: bounded Analytics SQL query/result projection and/or a narrowly owned
Gateway URL/metadata projection with explicit fake providers, then typed C++/Wasm
examples. No native read should be attempted without the applicable account,
data, provider and cost plan. P11 remains open, not platform-unavailable.

## Sources

Read2026-10-14:

- [Analytics SQL binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/),
  [limits](https://developers.cloudflare.com/analytics/sql-api/limits/) and
  [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
  updated2026-10-02: scopes, response/dialect differences and constraints.
- [Gateway Worker methods](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/),
  updated2026-10-02: operations, gateway options and default auto-creation.
- [Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)
  and [logging](https://developers.cloudflare.com/ai-gateway/observability/logging/),
  updated2026-09-24: cohort-dependent logging, default collection, paid features.
- Pinned workerd [Gateway facade](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/cloudflare/internal/aig-api.ts),
  SHA256 `093e3031a23904b589b443dc0efd3761840193fd55f1d438561628a3215dca41`,
  and [AI facade](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/cloudflare/internal/ai-api.ts),
  SHA256 `166cb9e34356b6259384c6a0d06fd7e54eccde1d4138079fdf4d7da960965e33`.
  getUrl backend call, mutation/error behavior and conditional RPC path; source
  evidence only, not a provider call.
- Installed workers-types5.20261010.1 AnalyticsSQLBinding/AiGateway declarations
  are newer than the runtime, not availability proof. Pinned Miniflare index
  SHA256 `141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482`
  identifies the inspected analytics/AI proxy construction.
