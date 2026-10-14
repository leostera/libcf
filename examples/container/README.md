# Container inspection from C++ Durable Objects

`cf::Container(context.bindings).inspect()` returns
`AsyncResult<std::optional<ContainerInfo>>`. A present result owns its image string
and unique name/value label pairs; null means the provider returned no running
info, not that the DO/application/image/data has been deleted. Empty image is valid.
This API never starts, stops, signals, executes commands or snapshots a container.

```sh
bazel test //:container_local_test
bazel build //:container_bundle
```

The default example runs real C++/Wasm and Durable Objects with an **explicitly
fake Container metadata provider** (M), not Docker or a native Container binding.
The test subclass shadows its instance context after native construction solely
to substitute the fake capability; native methods retain their real receiver.
This is not a production extension API or a native lifecycle test.

The same C++ module handles frontend routing and per-object inspection. GET `/`
is a no-binding health route. Whitelisted scenario paths select distinct owned
fixture DO names: `/success`, `/none`, `/starting`, `/maximum`, `/bad`, `/short-timeout`,
`/invalid-timeout`, `/cleanup-fail`. The maximum result exercises2940 wire bytes.
Tests include eight concurrent calls, owned UTF-8/BOM/NUL image data, nullable
results, empty label values, error/deadline/cleanup recovery, and direct DO calls.
Output is human-readable text, **not delimiter-safe interchange**.

`test/missing.wrangler.jsonc` uses the production DO adapter with no Container
configured: inspection fails, rather than forging a successful null result.
`test/reserved.wrangler.jsonc` proves an environment binding cannot spoof the
reserved `__LIBCF_DO_CONTAINER` slot. The adapter borrows `ctx.container` for each
invocation; it never disposes or destroys that capability. Production Container
configuration is refused by the default local harness before engine discovery.

SDK limits: timeout1..60000ms (default5000), image0..2048 UTF-8 bytes, at most10
labels with names1..16 and values0..64 bytes, no C0/C1 controls in labels. The C++
decoder rejects bad kinds/presence/count/UTF-8/controls, duplicate names, every
truncated reply and trailing bytes. Image text is opaque metadata, not validated
registry syntax or launch authorization. Label ordering is not promised stable.

Request activity may extend a running container's idle retention/cost. Timers do
not establish native cancellation, stopped work/billing, readiness or erasure.
Native object materialization/key enumeration precedes projection caps. Separate
runtime calls would not form an atomic running/readiness snapshot.

The production config contains an image placeholder and no authentication: **do
not deploy it as-is or attach it to existing data/applications**. Native validation
needs an approved owned engine/image or paid-account lifecycle fixture, explicit
runtime/egress/authenticated ingress and cleanup plans. Compatibility2026-10-13
matches pinned workerd; workers.dev/previews are disabled. See
[Container readiness](../../docs/container-readiness.md) for prerequisites and the
separate, still-unimplemented mutating lifecycle/port APIs.
