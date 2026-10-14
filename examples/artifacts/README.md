# Artifacts repository metadata

`<cf/artifacts.hpp>`, operation496, actual C++/Wasm with an **explicit fake
repository provider**. Pinned Miniflare has only a remote Artifacts proxy; these
tests do not establish native repository/Git behavior or account authorization.

```sh
bazel test //:artifacts_local_test //:native_artifacts_test
bazel build //:artifacts //:artifacts_bundle
```

`POST /info` takes an existing repository name in its body; empty selects
`libcf-owned-repo`. It returns only ID, name, default branch and read-only flag
as human-readable lines, not delimiter-safe interchange. `/missing` and
`/short-timeout` demonstrate errors. Lookup does not create a repository.

```cpp
cf::Artifacts artifacts(context.bindings, "ARTIFACTS");
auto result = co_await artifacts.info("libcf-owned-repo");
```

`ArtifactsInfoOptions` defaults to5000ms, valid1–60000. Name1–128 ASCII bytes,
first alphanumeric, remaining alphanumeric/dot/underscore/hyphen. Input is
validated before bounded owned copies; caller views/options do not escape.
These are libcf subset limits, not the full platform naming contract.

`ArtifactsRepositoryInfo` owns `id`, `name`, `default_branch`, `read_only`.
ID1–128 UTF-8 bytes, exact echoed name, branch1–256; ID/branch are opaque metadata,
not parsed Git refs or safe command arguments. BOM/NUL are preserved. Wire19–528
bytes; strict decoder checks reply kind, boolean, UTF-8, field bounds, name match,
truncation and trailing data. No URL, credentials, descriptions or timestamps are
projected. Provider materialization is not bounded by these projection caps.

Tests cover eight concurrent fake lookups, maximum metadata, owned UTF-8/BOM/NUL,
invalid input, lookup failure, malformed metadata, cleanup failure, deadlines at
lookup/read and recovery. Native unit tests include1MiB invalid lvalue names and
mutation after call. RPC tests use fake repositories and prove capability cleanup,
not native Artifacts semantics. Disposal is not deletion, stopped work or billing.

The production config is an unapproved namespace placeholder and the ordinary
harness refuses it. Do not deploy this unauthenticated lookup endpoint as-is:
caller-supplied names need tenant authorization and approved data access. Native
verification needs an owned repository and explicit budget/credential/cleanup
plan. No create/list/import/tokens/fork/delete/file operations are implemented.
See [scope and pricing audit](../../docs/flagship-artifacts-readiness.md).
