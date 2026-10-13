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

Live SHA-256/384/512 verification passed after DNS recovery: empty/binary/1-MiB inputs, concurrent isolation, oversized input rejection/recovery and RNG/UUID smoke. The two earlier deployments failed DNS readiness before assertions; the successful isolated retry and all its resources were cleaned up. No TLS verification was disabled. See [deployment and cleanup evidence](../../docs/live-verification.md). Run `node scripts/build-live-worker.mjs crypto`, deploy from `build/live-crypto` after ownership preflight, then `LIBCF_LIVE_READY_TIMEOUT_MS=2400000 node scripts/test-live-crypto.mjs <host>` to retain that hostname through a bounded 40-minute readiness window when DNS needs to outlast a negative TTL. No keys, credentials or persistent binding resources are needed. SHA-1/MD5, keys/import/export, signatures, encryption, HMAC, timing-safe comparison and streaming `DigestStream` are not implemented by this API. Structured logging and calendar APIs remain gaps; bounded coroutine sleep and synchronous wall-clock reads are available separately through `<cf/timer.hpp>` and `<cf/clock.hpp>`.

Source retrieved 2026-10-13: [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
