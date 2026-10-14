# Vectorize binding readiness

Audited 2026-10-14 against current Cloudflare documentation and workerd
1.20261006.1 / Miniflare5.20261006.1-alpha. A bounded C++ IDs/scores-only query
is now implemented with [an explicit mock example](../examples/vectorize/README.md).
No native-provider or live Vectorize verification is claimed.

## Supported platform surface

The GA/V2 binding is `Vectorize`, not the deprecated V1 `VectorizeIndex` type.
Its public methods are `describe`, `query`, `queryById`, `insert`, `upsert`,
`getByIds` and `deleteByIds`. V2 mutations return a mutation identifier; acceptance
is not visibility. Upsert replaces a record, including metadata, rather than
merging it. Index creation/deletion, metadata-index management and listing vector
IDs are control-plane operations, not methods of the pinned binding.

The pinned Miniflare plugin wraps the native binding with a **remote proxy**, not
a local vector index. The local harness therefore rejects a `vectorize` config
before bundling or runtime startup. The explicit JS query mock is classified
**M**, not native local provider coverage. The refusal test uses no credentials,
index or network service.

## Boundaries for implementation

- Dimensions are fixed by the index:1–1536, stored at float32 precision. Reject
  non-finite input; do not silently accept finite doubles outside float32 range.
  Matching dimensions alone does not establish embedding-model compatibility.
- IDs and namespaces have64-byte limits; metadata has10KiB per vector. Limits
  apply to encoded bytes, not JavaScript string length.
- The documented Workers mutation batch maximum is1000, distinct from the HTTP
  API's5000. A libcf subset may impose a smaller total-byte/record budget.
- Query results are bounded by `topK`, but documentation disagrees at one edge:
  the limits table says50 when returning values **or metadata**, while the API
  page permits100 with indexed metadata and only caps full metadata/values at50.
  Start with IDs/scores only (up to100), or conservatively cap any metadata at50.
  Do not silently claim the disputed indexed-metadata edge is provider verified.
- Scores depend on the configured metric; do not impose a cosine-only range on
  dot-product or Euclidean results. Namespace selection is not authorization.
- The native binding parses its response internally (`response.text()` followed
  by JSON parsing; error responses also parse internally). There is no public
  raw-response or AbortSignal option. libcf can bound its owned input/result and
  reject malformed returned objects, **not bound the provider's earlier parsing**.
  A local timeout/cancellation may ignore a late result; it cannot promise to
  interrupt native parsing, stop usage or roll back a mutation. No automatic retry.

There is another source discrepancy: the installed type's insert comment says an
existing ID throws, while the current API docs say existing IDs are preserved and
only new IDs inserted. Keep duplicate-insert behavior unverified until an owned
provider test resolves it; do not derive V2 semantics from V1 result shapes.

## Live plan, not authorization

Use an exclusively owned V2 index, fixed synthetic vectors (no AI inference),
a bounded number of reads/writes and authenticated or otherwise tightly bounded
ingress. Verify mutation visibility separately from its acknowledgement, then
independently verify index/Worker/domain cleanup. Never query an unrelated index.
Obtain approval for retained dimensions and usage first: account-wide remaining
allowances are unknown. Current pricing includes50M queried /10M stored dimensions
on Paid, then$0.01 per million queried and$0.05 per100M stored; Free has lower
limits. CLI and HTTP queries count too. No account operation occurred in this audit.

## Sources

- [Binding API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Index configuration and scores](https://developers.cloudflare.com/vectorize/best-practices/create-indexes/)
- [Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Pinned native adapter](https://github.com/cloudflare/workerd/blob/v1.20261006.1/src/cloudflare/internal/vectorize-api.ts)
- Pinned Miniflare distribution: `VECTORIZE_PLUGIN`, `cloudflare-internal:vectorize-api`,
  `VECTORIZE_REMOTE_SERVICE_NAME`; installed Workers types: `Vectorize` vs `VectorizeIndex`.
