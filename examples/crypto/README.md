# Web Crypto digests

```sh
bazel build //:crypto
bazel test //:crypto_local_test
```

`cf::SubtleCrypto(context.bindings)` exposes `sha256`, `sha384`, and `sha512`, returning fixed-size byte arrays through `AsyncResult`. Inputs are owned binary bytes, including empty values, with a 1 MiB cap. No configured resource binding is needed.

POST bytes to `/sha256`, `/sha384`, or `/sha512` for hexadecimal output. `/random` and `/uuid` use platform randomness. Cancellation does not promise to stop already-running computation. Key management, signatures, encryption, HMAC, streaming digests, and timing-safe comparison are not exposed by this API.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
