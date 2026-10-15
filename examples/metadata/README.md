# Version metadata and secrets

```sh
bazel build //:metadata
bazel test //:metadata_local_test
```

`cf::VersionMetadata(runtime, binding).get()` returns owned ID, tag, and timestamp strings. Empty tags are valid; timestamps remain opaque strings. `cf::SecretsStoreSecret(runtime, binding).get()` reads an owned string anew on each call. Both have a 64 KiB limit; empty secret values differ from failure.

`GET /version` shows metadata. `POST /secret-check` compares against a synthetic local value and returns only match/mismatch with no-store. It is not constant-time authentication and must never use production secrets. Provider secret errors are redacted, but buffers are not securely erased. Tests seed only local secrets; no live secret access is established.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
