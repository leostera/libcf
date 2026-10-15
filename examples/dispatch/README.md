# Dynamic Worker dispatch

```sh
bazel build //:dispatch
bazel test //:dispatch_local_test
```

`cf::DispatchNamespace::fetch(DispatchTarget, Request)` selects a user Worker by name and performs one buffered HTTP call. Names are 1–63 ASCII alphanumeric/underscore/hyphen characters, starting alphanumeric. Applications must authorize selection and strip platform credentials.

Requested limits are 1–30000 CPU ms and 0–1000 subrequests, default 50/0; CPU is not wall time. Request wire is capped at 1 MiB; response bodies at 1 MiB and headers at 64 KiB. Redirects are manual, error statuses remain responses, and no retry is performed. The local mock namespace returns a real local Fetcher but does not prove native namespace routing, resource enforcement, or tenant isolation. Props, RPC, streaming, upgrades, and namespace administration are not exposed.

**Local provider: mock.** Tests execute C++/Wasm but do not establish native provider behavior or production availability. Default local harnesses refuse remote configurations.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
