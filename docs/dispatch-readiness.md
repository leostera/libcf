# Dynamic dispatch readiness

Audited2026-10-14 against current docs, Workers types5.20261010.1 and pinned
Miniflare5.20261006.1-alpha. A [buffered C++ dispatch subset](../examples/dispatch/README.md)
now has explicit mock coverage. No native WfP/live verification is claimed.
Regular service-binding tests do not establish Workers for Platforms (WfP)
namespace routing, isolation or limit enforcement.

## Native contract and scope

`env.DISPATCHER.get(name, args?, options?)` returns a Fetcher. Current docs support
`args.props` passed to the user Worker's `ctx.props`, including JSON data and RPC
capabilities. `options.limits` supplies `cpuMs` / `subRequests`; `options.outbound`
passes values to configured outbound-worker parameters. These are distinct inputs,
not one interchangeable options object. RPC stubs in props are request-scoped:
storing one for a later request does not make cross-request I/O legal.

The implemented libcf subset uses one owned, bounded HTTP request/reply per call,
preserving method, headers, binary data, status and body cancellation. It supplies
explicit CPU/subrequest limits but excludes props, including JSON and RPC capabilities. Native CPU/subrequest
limits are not local wall-clock deadlines; a recorded mock argument does not prove
the provider enforced it. Handle both synchronous lookup failure and asynchronous
fetch rejection, without implicit retries or remote rollback promises.

A namespace binding can select any user Worker in that namespace. The application
must authorize the target; a valid name or hostname-derived string is not tenant
authorization. Resolve the Fetcher per call instead of retaining request-scoped
props/capabilities globally. Namespace creation, uploads, tags and deletion belong
to the external cf CLI test harness, not a new account-admin API in libcf.

## Local development is not local provider coverage

Pinned Miniflare's `DISPATCH_NAMESPACE_PLUGIN` uses the module named
`local-dispatch-namespace`, but that module simply forwards `get` to a **remote
proxy**. Its name is not evidence of a local namespace emulator. Official local
development documentation likewise connects a local dispatcher to deployed user
Workers. The local harness now rejects `dispatch_namespaces` before bundling or
runtime startup. The explicit namespace mock is **M**, not native local L/V.

## Isolation and fees

Untrusted namespaces are the documented default: no `request.cf`, isolated caches
and disabled `caches.default`. Trusted mode changes these properties and must not
be enabled merely to make a probe pass. Outbound Workers block the user Worker's
outbound TCP `connect()` API, but do not intercept fetches from Durable Objects or
mTLS bindings. This is not a claim about ordinary service TCP bindings elsewhere.

WfP is a separate published **$25/month** plan, with request/CPU/script allotments
and overages. Account entitlement and remaining allowances have not been checked.
Do not enable a subscription or create a namespace to discover whether it incurs
fees. Before live work, obtain entitlement/budget confirmation; then use an owned
namespace and fixed user Worker, approved HTTPS frontend, bounded authenticated
traffic and independent namespace/script/Worker/domain cleanup. This audit did not
create resources, route to a customer Worker or make an account API call.

## Sources

- [Dynamic dispatch and props](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [Custom limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/)
- [Local development](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/)
- [Isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/)
- [Outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/)
- [Pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/)
- [Pinned Miniflare](https://www.npmjs.com/package/miniflare/v/5.20261006.1-alpha),
  `DISPATCH_NAMESPACE_PLUGIN` and `dispatch-namespace.worker.js` in its installed distribution.
