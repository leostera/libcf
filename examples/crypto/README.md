# Web Crypto from C++

```sh
npm ci
node scripts/build-worker.mjs examples/crypto/wrangler.jsonc
node --test examples/crypto/test/*.test.mjs
```

Included in the default test suite. `cf::SubtleCrypto(context.bindings)` uses the request-scoped operation channel to call platform `crypto.subtle.digest`; no configured resource binding or cryptographic reimplementation is needed.

- `sha256(Bytes)` → `AsyncResult<std::array<std::uint8_t, 32>>`
- `sha384(Bytes)` → `AsyncResult<std::array<std::uint8_t, 48>>`
- `sha512(Bytes)` → `AsyncResult<std::array<std::uint8_t, 64>>`

Input is owned and bounded to 1 MiB per call (an SDK limit), including valid empty input. Both bridge sides reject malformed output; the C++ result size is fixed by the chosen algorithm. Raw binary input is not converted through UTF-8. Native hashing failures remain errors, distinct from a valid digest. As with other operations, cancellation discards late completion; it does not promise to interrupt cryptographic computation already running.

`POST /sha256`, `/sha384` and `/sha512` return hexadecimal digests. `/oversized` exercises the C++ input guard. `/random` and `/uuid` demonstrate existing `context.crypto` APIs backed by the platform RNG. Sampling distinct values is a smoke check, not an entropy/security audit.

Three workerd cases cover a published SHA-256 vector, all three algorithms against Node/OpenSSL reference digests for empty/binary/1-MiB data, concurrent request isolation, rejection and recovery, and RNG/UUID smoke checks. Native tests enforce compile-time result sizes and malformed replies; JS tests cover subarray offsets, bounds, unsupported algorithms and provider failures.

Live digest verification is blocked by hostname resolution, not marked passed: the first isolated deployment's 15-minute readiness window ended in `ENOTFOUND`. A fresh deployment had a matching proxied DNS record in the API but DNS diagnostics still returned `NXDOMAIN`; no digest assertion reached either Worker. No TLS verification was disabled. See [deployment and cleanup evidence](../../docs/live-verification.md). Run `node scripts/build-live-worker.mjs crypto`, deploy from `build/live-crypto` after ownership preflight, then `node scripts/test-live-crypto.mjs <host>` when DNS is working. No keys, credentials or persistent binding resources are needed. SHA-1/MD5, keys/import/export, signatures, encryption, HMAC, timing-safe comparison and streaming `DigestStream` are not implemented by this API. Date, timer and structured logging APIs are separate coverage gaps.

Source retrieved 2026-10-13: [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
