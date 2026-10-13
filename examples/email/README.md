# C++ inbound email events

```sh
npm ci
node scripts/build-worker.mjs examples/email/wrangler.jsonc
node --test examples/email/test/*.test.mjs
```

The default `npm test` also builds/runs this example. Tests use Miniflare's local email simulator with `format=json`; **no real mail is sent**. Reserved `example.test` addresses are local fixtures only, not live destinations.

`createEmailWorker(factory, wasm)` dispatches email and fetch events to C++ `cf::handle`. Check `context.env.var("__LIBCF_EMAIL_EVENT") == "email"`, then call `cf::email_message(env, request)` to obtain owned SMTP envelope strings, logical headers and opaque raw MIME bytes. This is a separate adapter from the Queue/scheduled adapter. It does not parse multipart MIME or authenticate senders: envelope/header addresses alone are not proof of identity.

The header wire and raw bytes share a **1 MiB total bridge budget**, including length prefixes and up to 64 KiB of logical headers. Thus the raw-message allowance depends on header overhead. Email headers are encoded separately rather than copied into synthetic HTTP headers: an attacker-supplied MIME `Content-Length` cannot change bridge framing. Raw size mismatches and over-budget input fail before C++ dispatch.

C++ must explicitly return one disposition:

- `email_consume()` — finish without forwarding, e.g. after committing durable processing.
- `email_reject(reason)` — permanent SMTP rejection, with a nonempty single-line reason of at most 512 UTF-8 bytes.
- `email_forward(destination)` — await native forwarding to one configured, verified destination. A failure propagates; it is never silently converted into success.

Generic 2xx responses are not dispositions. The native forwarding operation remains authoritative; if the runtime explicitly reports `canBeForwarded: false`, the adapter rejects forwarding. The pinned local simulator does not supply that property, so the SDK does not fabricate a C++ capability flag.

The example stores raw mail and envelope metadata in D1 before consuming it, using Message-ID as a deduplication key (an application policy, not an SDK requirement). `POST /lookup` with the Message-ID reads it back. Two fixture recipients exercise rejection and forwarding. The lookup is an unauthenticated test endpoint: add application authorization before adapting it to a real inbox.

Five local workerd tests cover consumption/storage with a forged MIME Content-Length, rejection, captured forwarding, handler/missing-disposition failures and oversized input. Native and direct-adapter tests cover malformed wire data, binary bytes, SMTP null reverse paths, cancellation, unverified-destination errors and reserved metadata conflicts.

**Live email is not verified.** A read-only `cf email-routing settings get --zone leostera.dev` reported enabled/ready routing on 2026-10-13. Existing routing rules and DNS were not changed. Live SMTP delivery/forwarding needs an approved isolated address and controlled sender/destination; do not send to fixture addresses or modify existing mail routing. No destination-verification emails were requested.

Not implemented: native reply(), multiple forwards, custom forwarding headers, outbound SendEmail, MIME construction/parsing, delivery receipts or spam/DMARC policy. Local forwarding simulation does not prove recipient verification or delivery.

Sources retrieved 2026-10-13: [email handler API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/), [local routing tests](https://developers.cloudflare.com/email-service/local-development/routing/).
