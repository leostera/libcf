# Pinned platform declaration contracts

```sh
bazel test //:platform_contracts_test
```

This development-only check uses integrity-pinned Workers types **5.20261006.1**,
TypeScript **6.0.3**, Miniflare **5.20261006.1-alpha** and workerd **1.20261006.1**.
The existing84 locked packages are unchanged; only the two static-analysis
packages were added. Nothing is installed or generated into the SDK bundle.

## What is checked

- Parse the actual `lib/image-rotate.mjs` with the TypeScript parser. Extract all
  three `invoke(receiver, literalMethod, literalArgumentsArray)` call sites.
  Receiver roles are explicitly annotated as `ImageTransformer` or
  `ImageTransformationResult`; their actual argument expressions are printed into
  a virtual TypeScript source and checked against the pinned declarations.
  Unclassified receivers, dynamic method/argument forms and changed site count
  fail instead of being silently skipped. This covers transform/output/contentType,
  not arbitrary dynamic calls or complete control flow.
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
  `MiniflareWorkerConfigSchema` and reject an unknown binding kind. No runtime
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
flow. Reflect.apply sites and helper control flow are not automatically checked.
Schema acceptance is not complete deployment validation; unknown properties may
be stripped. Known binding kinds include internal/development facilities and are
not an advertised product inventory or account entitlement.

All remaining adapters, richer signatures/configuration comparisons, compatibility
flags and operation-level support classification still need coverage. F05 remains
incomplete. No declarations from neighboring repositories or newer releases are
used as pinned-runtime evidence. No account operations or live probes are involved.
