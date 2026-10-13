# Version metadata and Secrets Store reads

```sh
npm ci
node scripts/build-worker.mjs examples/metadata/wrangler.jsonc
node --test examples/metadata/test/*.test.mjs
```

Included in the default test suite. `cf::VersionMetadata(runtime, binding).get()` returns owned `WorkerVersion { id, tag, timestamp }` strings. Empty tags are valid. Timestamps retain the platform's string representation; this API does not parse time zones or implement a date parser. The version wire is bounded to 64 KiB.

`cf::SecretsStoreSecret(runtime, binding).get()` returns an owned string, with a 64-KiB SDK limit. Empty values are distinct from read failures. Each call reads the binding anew, without a module-global value cache. Provider error text is replaced with a generic failure to avoid accidentally propagating a value embedded in an error. Strings and JS buffers are not guaranteed to be securely erased from memory.

`GET /version` reports metadata. `POST /secret-check` compares the request body to a **synthetic test value**, returning only match/mismatch with `Cache-Control: no-store`. This is a diagnostic fixture, not a constant-time authentication API. Do not expose it with production secrets; it must never return or log the value.

Two workerd cases verify stable local version metadata and a local secret's absence, empty value, rotation, comparison and deletion. Tests seed only local Miniflare storage through its admin test API. Native/direct-adapter tests cover malformed wire data, empty/binary/UTF-8 values, bounds and provider-error redaction. No remote secrets are fetched by local tests.

Live verification is pending. A read-only store listing found an existing default account store; no existing secrets were listed, fetched, changed or deleted. A live secret test requires approval to create and later delete a uniquely named synthetic fixture secret in an appropriate store. Version metadata can be verified independently without adding a secret binding.

Sources retrieved 2026-10-13: [version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/), [Secrets Store Workers integration](https://developers.cloudflare.com/secrets-store/integrations/workers/), project-pinned Worker types and Miniflare admin API.
