# Artifacts repository metadata

```sh
bazel build //:artifacts
bazel test //:artifacts_local_test
```

`cf::Artifacts::info(existing_name)` returns owned ID, name, default branch, and read-only status without creating a repository. POST a name to `/info`. Names are 1–128 ASCII alphanumeric/dot/underscore/hyphen characters, starting alphanumeric; timeout is 1–60000 ms.

ID and branch strings are opaque metadata, not safe shell arguments or validated Git refs. Result projection is bounded to 528 wire bytes. Lookup requires application access control. No create/list/import/token/fork/delete/file APIs are exposed; disposal is not repository deletion.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
