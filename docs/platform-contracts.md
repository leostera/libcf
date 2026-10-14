# Pinned platform declaration contracts

```sh
bazel test //:platform_contracts_test
```

This development-only check uses integrity-pinned Workers types **5.20261006.1**,
TypeScript **6.0.3**, Miniflare **5.20261006.1-alpha** and workerd **1.20261006.1**.
The existing84 locked packages are unchanged; only the two static-analysis
packages were added. They are not Worker runtime/bundle dependencies; the shared
lock metadata remains part of the SDK archive.

## What is checked

- Parse the actual `lib/image-rotate.mjs` with the TypeScript parser. Extract all
  three `invoke(receiver, literalMethod, literalArgumentsArray)` call sites.
  Receiver roles are explicitly annotated as `ImageTransformer` or
  `ImageTransformationResult`; their actual argument expressions are printed into
  a virtual TypeScript source and checked against the pinned declarations.
  Unclassified receivers, dynamic method/argument forms and changed site count
  fail instead of being silently skipped. This covers transform/output/contentType,
  not arbitrary dynamic calls or complete control flow.
- For Queue single/batch sends, Analytics SQL, AI Gateway, Sites and outbound GET,
  extract seven actual
  `Reflect.apply` provider sites. Resolve their cached method selectors from the
  source (`send`, `sendBatch`, `query`, `gateway`, `getUrl`, `get`, `fetch`) and require the matching
  receiver. Emit the actual arguments; split Gateway's conditional argument list
  into branches so omission remains distinct from passing undefined. Reviewed
  receiver and input-value types are annotations, not inferred data flow.
  Known disposal/cancel calls have checked origins/counts but are not type-checked.
  Unknown reflective targets, duplicate selectors, mismatched receivers and site
  drift fail. Mutation checks exercise unknown targets, wrong receivers and a
  nonexistent SQL method. Indirect aliases and other call syntax remain outside
  this deliberately narrow extraction grammar.
- A separate handwritten fixture checks input/info and result image/response call
  shapes. Four negative sentinels require errors for absent/unsupported format,
  string rotation and a nonexistent result method. Strict checking is enabled;
  declaration checking is not skipped. Generated source participation and the
  exact imported package text are asserted, avoiding an empty-program pass. A
  mutation of the generated rotation argument to a string must produce a type
  error in that virtual file.
- Generate the member-name surfaces of ImagesBinding, ImageTransformer,
  ImageTransformationResult, HostedImagesBinding and ImageHandle from compiler
  symbols. Generate all43 known binding-kind tags from Miniflare's exported
  `ParsedMiniflareKnownBindingSchema`. Validate an Images configuration through
  `MiniflareWorkerConfigSchema` and reject an unknown binding kind. Also check AI,
  Analytics, KV, mTLS and VPC configurations with synthetic identifiers. Missing
  mTLS/service IDs and a VPC Network without either identifier fail. Worker config
  **synthesizes an omitted KV ID** as `bindingName-workerName`, while the normalized
  binding schema requires it; the initial contrary assertion failed. This local
  identity is not a Cloudflare namespace ID. KV syntax is not a Legacy Sites
  manifest/deployment check. No runtime
  instance is started and no provider method is called by this check.
- Report package versions, generated calls/surfaces and a SHA-256 of the actual
  imported `index.ts`: `a4a5c81091504b47ac4f910391c7dd65778f5eebb88a28243818f2e7cd61313d`.
  In this package, module imports resolve to exported **index.ts**, not the separate
  ambient **index.d.ts**. The original assertion assuming `.d.ts` correctly failed.

## Limits and remaining work

Matching release-date suffixes do not prove identical generation flags, runtime
build provenance, compatibility-date behavior or provider availability. Static
assignability does not verify receivers at runtime, ownership/disposal, snapshots,
size bounds, authorization, billing or cancellation. Existing JS/native tests
remain necessary. Hosted member names do not imply C++ hosted implementations.

The receiver annotations are reviewed semantic assumptions, not inferred data
flow. Only the enumerated Reflect.apply forms are checked; helper control flow,
request-object construction and runtime value refinements are not inferred.
Schema acceptance is not complete deployment validation; unknown properties may
be stripped. Known binding kinds include internal/development facilities and are
not an advertised product inventory or account entitlement.

All remaining adapters, richer signatures/configuration comparisons, compatibility
flags and operation-level support classification still need coverage. F05 remains
incomplete. No declarations from neighboring repositories or newer releases are
used as pinned-runtime evidence. No account operations or live probes are involved.
