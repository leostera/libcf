# Platform contract tests

```sh
bazel test //:platform_contracts_test
```

This contributor check compares selected adapter calls against pinned Workers type declarations and validates selected local configuration shapes with Miniflare. TypeScript and Workers types are test dependencies, not Worker runtime dependencies.

## Maintaining the checks

`tests/platform-contracts/` parses actual adapter source and generates TypeScript calls for Images transform/output/contentType and selected reflective Queue, Analytics SQL, Gateway, Sites, and outbound fetch calls. Receiver and input types are explicit reviewed annotations, not inferred data flow.

Unknown receivers, dynamic forms, mismatched selectors, and changed call counts fail rather than being silently skipped. When changing these adapters, update the annotations deliberately and preserve mutation tests that reject wrong receivers, unknown methods, and invalid arguments. The handwritten fixture separately checks Images inputs/results. The test asserts declaration/source participation so an empty program cannot pass unnoticed.

Configuration checks cover selected Images, AI, Analytics, KV, mTLS, and VPC shapes. Worker configuration can synthesize a local KV ID, whereas the normalized binding schema requires it; that ID is not a deployed namespace. Module imports resolve to the pinned package's exported `index.ts`, not its separate ambient `index.d.ts`.

## Limits

These checks do not start providers. Static assignability and schema acceptance do not establish runtime availability, deployment validity, authorization, ownership, billing, or cancellation. Schemas may strip unknown properties. Member names do not imply implemented C++ APIs.

Only the explicitly handled call forms are checked. Indirect aliases, control flow, runtime refinements, and other adapters still require code review and functional tests. Keep native C++, JS adapter, and local Wasm tests alongside these contracts; do not substitute newer type declarations for the pinned runtime's APIs.
