# Container inspection

```sh
bazel build //:container
bazel test //:container_local_test
```

`cf::Container(context.bindings).inspect()` in a Durable Object returns optional image/label metadata. A null result means no running info was returned—not that an application or data was deleted. No start/stop, execution, signals, snapshots, or port APIs are exposed.

Timeout is 1–60000 ms; image strings up to 2048 UTF-8 bytes; up to ten labels with names 1–16 and values 0–64 bytes. Image strings are opaque, not launch authorization. The adapter borrows `ctx.container`; it does not destroy it. Inspection may extend idle retention/cost. The production image placeholder must not be deployed unchanged.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
