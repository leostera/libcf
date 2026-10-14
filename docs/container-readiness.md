# Containers: runtime scope and verification gates

Audit2026-10-14. **No C++ Container API, operation ID or runnable Container example
yet.** This is D05 implementation planning, not a native Container pass. No engine
was contacted, image acquired/built/pushed, container started, or account resource
accessed. The local Docker CLI being present does not establish a usable or
approved engine. Existing C++ Durable Objects and service TCP do not prove
Container lifecycle support.

## Worker-accessible API, not an administration client

The current [runtime API](https://developers.cloudflare.com/containers/api/durable-object-container/)
is `DurableObjectState.container`, an optional capability inside a configured DO.
It is not an ordinary environment Fetcher. The current docs recommend the direct
API for new applications; `@cloudflare/containers`'s `Container` class is a separate
higher-level wrapper. Do not substitute its `stop`, `sleepAfter` or lifecycle hooks
for methods on the native capability.

Inspected Workers types5.20261010.1 declare `running`, `images`, `start`, `monitor`,
`destroy`, `signal`, `getTcpPort`, `setInactivityTimeout`, interception, `exec`,
`inspect` and snapshots. These newer types are not proof of availability in the
pinned workerd1.20261006.1. Current libcf's DO adapter forwards storage/events but
not `ctx.container`; that plumbing and reserved-name protection are still missing.

| Native surface | Contract relevant to a future C++ wrapper |
| --- | --- |
| `start(options)` | Synchronous validation/acceptance, not readiness or successful startup. Already running throws; later startup errors require observation. |
| `running` | True can precede readiness. Never interpret as an accepting TCP port or healthy application. |
| `images` | Named digest-pinned references for `durable_object` scheduling policy; prefer approved configured aliases over arbitrary registry/command inputs. |
| `inspect()` | Nullable image/labels projection. Empty image is documented during startup/snapshot restore; it is not automatically malformed. Separate reads of running/inspect are not an atomic snapshot. |
| `getTcpPort(port)` | Returns a Fetcher for HTTP/TCP; application readiness still required. Existing service TCP codec may be reusable, but has not exercised Container ports. |
| `signal(number)` | Sends a signal, not completion/exit proof. Graceful shutdown can continue doing work. |
| `destroy(reason?)` | Async stop operation; await its outcome. Not deletion of the DO, application, image, snapshot, or external data. |
| `monitor()` | Resolves on normal exit/destroy; rejects on errors/nonzero exit. Not a readiness promise. Must be re-established after DO restart; can prevent eviction for up to15 minutes. |
| `setInactivityTimeout(ms)` | Current docs require greater than0 and at most21600000ms. Resets on DO restart; continued requests postpone inactivity. Not a hard execution/billing deadline. |
| `exec`, snapshots, interception | Separate future scope: process trees, streams, signal-after-exit errors, retained snapshots and egress rules require their own contracts. |

The `default` scheduling policy chooses image/size from deployment configuration.
The `durable_object` policy chooses an image/snapshot and optional size on start;
`enableInternet` is required when options are supplied. An omitted start argument
is not interchangeable with an options object. A minimal future SDK should select
one explicit policy first, not silently fall back or guess image names.

## Why the default local harness refuses Container declarations

The pinned Miniflare5.20261006.1-alpha source has real engine integration:

- Attached DOs accept `container.imageName` or named `container.images` mappings.
- Service construction detects container-enabled classes and calls
  `ContainerPrivilegesCache.get`; on local macOS/Linux paths this can invoke
  `docker --host ... info` **before application start()**.
- Conditional FUSE privilege detection can add `SYS_ADMIN`, `/dev/fuse` access and
  `apparmor:unconfined`; review these grants before any native image execution.
- The default engine points to the system Docker socket. The default egress
  sidecar is digest-pinned, but `MINIFLARE_CONTAINER_EGRESS_IMAGE` and explicit
  engine options can override it. None of these are declared libcf toolchains.

Previously the example harness dropped top-level `containers` rather than mapping
it. It now rejects any explicit `containers` property (including empty/malformed
values) and `exports.*.container` declarations before bundling that worker and
before creating the group runtime. This includes additional worker configs.
`tests/container-policy.test.mjs` uses missing entrypoints to verify fail-closed
policy ordering; it is **policy evidence only**, not a native Container fixture.
Ordinary DO fixtures remain enabled. Explicit fake-provider examples can use a
separate configuration without Container declarations; label them M, not L.

A future native local harness needs an explicitly owned engine/socket, pinned
Docker-compatible toolchain, linux/amd64 image and sidecar digests, declared build
inputs, no implicit registry login/pulls, bounded concurrency, and independent
instance-exit/cleanup checks. Local docs say `max_instances` is not enforced
locally and images survive dev-session disposal. Never run broad image pruning or
remove unrelated engines/images/volumes. Native local verification is **not yet
attempted**, not established as unavailable.

## Lifecycle, data and cost gates

[Architecture](https://developers.cloudflare.com/containers/concepts/architecture/)
distinguishes DO persistence from ephemeral container disk. Restarts may move the
instance. Snapshots introduce retained data (current docs describe a30-day TTL
refreshed on restore); exclude them from an initial synthetic lifecycle probe.
Public end-user non-HTTP TCP/UDP ingress is not provided by this routing model.

[Pricing](https://developers.cloudflare.com/containers/platform/pricing/) as read
2026-10-14 requires Workers Paid ($5/month), with included usage—not authorization:
25GiB-hours memory,375vCPU-minutes and200GB-hours disk monthly. Above included usage,
rates are $0.0000025/GiB-second memory, $0.000020/vCPU-second active CPU and
$0.00000007/GB-second provisioned disk, metered every10ms while running. Network,
Worker/DO requests/duration and logs are separate. Memory/disk are provisioned,
not just used. Account entitlement/remaining allowance was not checked.

Before live verification: approve a synthetic image, resource/runtime budget,
authenticated ingress on an owned `*.libcf.leostera.dev` hostname, instance identity,
egress policy and cleanup of Worker/DO/application/image/DNS/certificates. Use cf
CLI only; no subscription activation or deployment during this audit. Independently
verify stopped instances and resource cleanup. Abort/timeout of a caller does not
prove stopped work, zero billing, rollback or erasure. Do not attach to existing
applications or use a successful deploy as a runtime pass.

## Bounded inspection JS prototype

`lib/container.mjs::performContainerInspect` borrows the DO capability and invokes
only `inspect()`, preserving its receiver. It has **no C++ operation/runtime wiring
or runnable C++ example yet**. Unit and real workerd service-RPC tests use fake
metadata providers, not a Container binding, engine or process.

Request: empty key/body, canonical timeout1..60000ms. The owned result is nullable;
when present, image is0..2048 UTF-8 bytes and labels are at most10 own enumerable
entries of a plain/null-prototype dictionary. Names are1..16 bytes and values0..64;
the SDK conservatively rejects C0/C1 control characters in labels. Empty image is
preserved, as are valid UTF-8/BOM and opaque image bytes; this is not image-reference
syntax validation or authorization to launch an image. Label names become pairs,
not assignments into an object. Unrelated fields and toJSON are not traversed.

Wire: little-endian u32 presence0/1; if present, length-prefixed image, u32 label
count, then length-prefixed name/value pairs. Null is4 bytes, maximum2940 bytes.
Object materialization/key enumeration precede projection caps; no strict native
heap bound. Null is the provider's no-running-info result, not deletion of its DO,
application or retained data. There is no independent running/readiness sample or
atomic state claim.

Pending read/result roots are conditionally synchronously disposed, identity-
deduplicated and held through projection; the borrowed container is never disposed
or destroyed. Timeout/abort drains late results/rejections without changing settled
outcomes. Cleanup failure rejects success but preserves a primary failure. This
does not stop native work or a container; invocation activity may extend its idle
window. Real RPC fixtures verify delivered nested capabilities become unusable and
the borrowed service remains callable—not process exit or server disposer timing.

## Sources and next implementation step

Primary docs read2026-10-14: [direct runtime API](https://developers.cloudflare.com/containers/api/durable-object-container/),
[local development](https://developers.cloudflare.com/containers/guides/local-dev/),
[architecture](https://developers.cloudflare.com/containers/concepts/architecture/),
[pricing](https://developers.cloudflare.com/containers/platform/pricing/).
Runtime/local/architecture pages report updated2026-09-30; pricing2026-10-05.
The older DO API URL redirects to the Containers API page; follow its canonical
Markdown URL rather than treating redirected HTML as API content.

Next: add a typed nullable inspection API, strict C++ decoder, DO capability
plumbing with reserved-name protection, and an independent explicit-mock example.
Mutating lifecycle/readiness operations need separate design and tests.
Native engine/image and account prerequisites remain separate approval gates.
No operation number is allocated by this audit.
