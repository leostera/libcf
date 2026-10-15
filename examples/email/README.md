# Inbound email

```sh
bazel build //:email
bazel test //:email_local_test
```

`createEmailWorker` sends email and fetch events to `cf::handle`. `cf::email_message(env, request)` returns owned SMTP envelope strings, logical headers, and raw MIME bytes. Return `email_consume()`, `email_reject(reason)`, or `email_forward(destination)` explicitly; generic HTTP success is not a disposition.

The total wire budget is 1 MiB, including up to 64 KiB of logical headers. Rejection reasons must be single-line, nonempty, and at most 512 UTF-8 bytes. Forwarding awaits the provider and requires an authorized verified destination. This API does not authenticate senders or parse MIME.

The example stores mail in D1 before consuming it and uses Message-ID for deduplication. `/lookup` is an unauthenticated diagnostic, not a public inbox API. Local tests simulate delivery/forwarding and send no real email. Native reply, multiple forwards, custom forwarding headers, outbound sending, and MIME construction are not exposed.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
