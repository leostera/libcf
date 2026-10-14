# mTLS and Workers VPC readiness

Audited 2026-10-14 against Miniflare5.20261006.1-alpha / workerd1.20261006.1,
compatibility date2026-10-13 and current public documentation. P10 remains open:
no dedicated libcf API/example/native verification yet. No account lookup,
certificate/key generation or upload, tunnel/route discovery, connector startup,
private address connection or deployment was performed.

## Different capabilities, not interchangeable fetchers

| Binding | Published Worker surface | Authority and verification boundary |
| --- | --- | --- |
| mTLS certificate | `binding.fetch()` using the standard Fetch signature, presenting the configured client certificate | Certificate identity is sent during TLS establishment. Requires an authorized destination and certificate lifecycle, not just any Fetcher-shaped object. |
| VPC Service | `binding.fetch()` to a pre-registered host/port | Configured target controls routing. URL host supplies Host/SNI; URL port is ignored in favor of configured ports. Fixed routing does not validate caller authorization or virtual-host selection. |
| VPC Network | `binding.fetch()` and documented async `connect(address)` | Runtime URL/address selects a destination reachable through the bound Tunnel or Mesh. This is broad private-network authority, not a single-service capability. |

The existing `cf::ServiceBinding` supplies a bounded fetch-shaped transport, but
has no mTLS identity proof or VPC routing policy. Its JS adapter constructs a
standard Request without an explicit redirect mode, deadline or destination
allowlist. Reusing that shape without reviewing redirect/Host/SNI/credential
handling is not a secure product-specific implementation. Current service TCP
verification is **Worker-to-Worker** and establishes neither VPC reachability nor
TLS behavior. Ordinary `cloudflare:sockets.connect()` does not gain private
network access just because a Tunnel exists.

## mTLS prerequisites

The Worker binding refers to an account-uploaded certificate/private key via
`mtls_certificates[].certificate_id`; it does not expose key bytes to C++. The
public setup guide requires SSL and Certificates Edit scope for upload. This is
not inbound API Shield client verification, Access authentication or a general
TLS/StartTLS socket option.

The guide explicitly warns that Workers mTLS requests to a Cloudflare-proxied
zone return520. Consequently another ordinary proxied Worker hostname is not a
valid mutual-TLS handshake proof. An approved native test needs an owned origin
with actual client-certificate verification, a trusted server certificate and a
non-proxied test hostname under `*.libcf.leostera.dev`. Do not relax normal server
TLS checks or use another domain to evade that requirement.

The plan must name certificate owner/issuer/expiry, private-key handling, exact
origin/path/methods, positive and negative client-auth cases, budget and cleanup.
Never read existing certificates/keys or reuse personal credentials. Keep keys
out of source, logs and example responses. Upload/deletion acknowledgements alone
do not prove origin trust removal, key erasure or stopped TLS sessions. Rotation
and independent account/origin cleanup checks remain separate obligations.

## VPC routing and documentation drift

Services pre-register a target reached through a connector; Networks can expose
any reachable host/port through a Tunnel or Mesh. The documented Mesh
`network_id: "cf1:network"` can encompass account devices, subnet/hostname routes,
WAN on-ramps and public egress through Gateway policies/logging. Do not bind an
existing broad account network as a convenient test fixture.

The API reference (updated2026-09-16) documents Network `connect()` as returning
`Promise<Socket>` and supporting **plaintext TCP only**, available on Network
bindings. Newer Service configuration docs (2026-10-12) describe HTTP and TCP
service types and certificate verification modes; the pinned Miniflare proxy also
enables raw TCP transport for both Service and Network bindings. These are
unequal evidence layers, not proof of tested Service-connect/TLS availability.
Keep raw TCP/StartTLS scope unresolved until the exact target contract is verified;
do not silently add TLS options or infer support from a generic Fetcher type.

Both published fetch APIs require absolute HTTP(S) URLs. For Services, the URL
host remains security-relevant as Host/SNI even though it cannot change routing.
For Networks it selects the real target, including port. The Service docs default
to full certificate chain and hostname verification and also describe weaker
modes. libcf must retain `verify_full`; no hostname-check bypass or disabled
verification for probes. Public CA and Cloudflare Origin CA trust is documented
for Service HTTPS, not a blanket guarantee for every route or socket API.

Binding roles include Connectivity Directory Bind/Admin; direct Tunnel binding
requires Admin. Role possession, binding IDs and successful configuration are
not permission to access unrelated services or data. Published pricing says free
open beta with a Workers plan, while Worker compute/requests still apply; connector
hosting, network traffic and logging can have separate costs. No account role,
remaining allowance or actual entitlement was checked. Published Service count
limit is1000/account; this is not a probe budget.

## Pinned local runtime and safe test policy

Miniflare's mTLS, VPC Services and VPC Networks plugins all install remote-proxy
services. There is no local client-certificate/private-routing emulator in these
plugins. A `remote: false` declaration cannot provide missing infrastructure.
A local HTTP fake can establish bounded forwarding mechanics but cannot prove
client authentication, real TLS identity, private DNS/routing, network isolation,
Gateway enforcement or cloud billing/cancellation.

The ordinary fixture harness now rejects `mtls_certificates`, `vpc_services` and
`vpc_networks` fields before bundling the affected worker, including empty/null
or explicit remote:false declarations and additional worker configs. It no longer
silently drops these fields. `tests/private-network-policy.test.mjs` checks this
ordering with missing entrypoints; it does not isolate arbitrary test code or
prove a native binding unsupported in production.

## Trusted destination-policy prototype

`lib/outbound-policy.mjs` adds a **configuration-only** boundary; it does not fetch
or implement a C++ mTLS/VPC operation. `parseBoundHttpsPolicy(JSONtext)` accepts
at most64KiB UTF-8 and64 records, each exactly `{kind,binding,name,url}`. Kind is
`mtls`, `vpc-service` or `vpc-network`; one binding cannot declare conflicting
roles. Duplicate role/binding/name entries reject. Binding names use1–64 uppercase
ASCII identifier characters, starting with a letter; endpoint names use1–64
lowercase ASCII letters/digits/hyphens, starting with a letter. These deliberate
subsets do not cover every possible platform binding name.

The private mapping and returned endpoint descriptors are immutable snapshots.
`selectBoundHttpsEndpoint(token,kind,binding,name)` requires an exact match, without
raw-URL, cross-binding or cross-role fallback. Use trusted deployment configuration,
never client-supplied policies. Parsing establishes structure and role consistency,
**not permission, binding provenance, certificate identity or verify_full**.
Shared JSON depth/node and duplicate-object-key semantics apply. Parse errors are
redacted rather than echoing malformed policy text or credential-bearing URLs.

Destinations must be exact canonical WHATWG HTTPS URL strings,1–2048 printable
ASCII characters, with no credentials, query/fragment (even empty), trailing-dot
host, port0 or silent normalization. Explicit non-default ports are accepted for
mTLS/Network; Service rejects URL ports because they do not select its configured
routing port. HTTP/plaintext is intentionally outside this first subset. Encoded
path semantics, DNS ownership/rebinding, actual route selection and server TLS
validation still require application/deployment review. Private IP literals are
not forbidden: their presence is neither access permission nor a connectivity test.

The intended follow-up is GET-only with no caller URL/path/header/body overrides.
No method, redirect, credential or header customization is accepted in policy
records. GET is not proof of side-effect-free behavior. Tests cover boundaries,
role collisions, opaque ownership and rejection paths in Node; native workerd
also parses/selects synthetic policies without a provider binding or outbound
fetch. This is parser evidence, not mTLS/VPC transport verification. Existing
remote-declaration guards and account-operation approval requirements remain.

## Bounded GET transport prototype (mock product evidence)

`lib/outbound-get.mjs::performBoundHttpsGet` selects the exact policy endpoint
before accessing the binding's fetch method, validates an empty byte body and
canonical1–60000ms timeout, then invokes the captured method with its original
receiver. It constructs a fresh GET Request from the fixed URL, manual redirects
and combined request/deadline signal. It does not copy an inbound Request, headers
or body, accept caller URLs, follow Location, retry, or inspect response URL as an
identity assertion. Runtime/transport-added metadata is not an anonymity guarantee;
`credentials:omit` is not substituted for reviewing certificate identity.

Only a real Response observed with status200 and redirected=false is supported.
All other statuses (including other2xx), redirects and malformed results fail;
headers, redirect destinations and error bodies are not projected. Accepted bodies
are null/empty or a real byte ReadableStream, incrementally copied into owned
bytes0–1MiB. The return shape is `{status:0,bytes}` for the prospective host bridge;
there is no C++ operation/header/example yet.

Pending/Response/body roots remain owned through reading; borrowed bindings are
excluded and cleanup is reverse/identity-deduplicated. Body access is cached once,
including throwing or synchronously aborting accessors. Late/rejected response
bodies are canceled without waiting for producer cleanup. Only acquired provider
Response roots expose a body: malformed nested Responses do not trigger recursive
metadata traversal. Cleanup failures reject success, never replace primary errors.
Cooperative deadlines/abort and disposal do not prove stopped work, rollback,
server disposer timing, identity, routing or billing limits.

`tests/outbound-get.test.mjs` covers request construction, role/input rejection,
byte limits, reused chunks, metadata non-traversal, child ownership, cleanup and
fetch/body/synchronous cancellation plus late rejection. Native workerd tests use
Worker-to-Worker **fake mTLS/VPC providers**: three role selections, no caller
credential/body forwarding, empty/binary/1MiB/oversize outputs, rejection of
redirect/error responses without a second-hop call, timeout and concurrent recovery.
This establishes forwarding mechanics, **not native mTLS authentication, VPC
connectivity, verify_full or private DNS/TLS**. No account/provider network is used.

## Recommended next implementation

Start with an explicitly bounded HTTP fetch subset and separate mTLS/VPC Service/
VPC Network identities or options. Parse exact allowed absolute destinations
before effects, reject URL credentials and unsupported schemes, preserve receiver
identity, cap body/headers, set manual redirects, and make any subsequent hop an
explicit authorization decision. Never turn inbound user URL/Host/Authorization
into unrestricted private-network or client-certificate authority. HTTP method
and destination authorization belong to the application; no adapter can infer
permission from syntactically valid inputs.

Explicit fake providers can verify wire/request ownership, cancellation/deadline,
redirect handling, credential/header policy and failure recovery in C++/Wasm.
Label those M. A native plan needs an owned isolated origin/network/connector,
allowlisted endpoints, non-sensitive synthetic data, role and budget approval,
normal TLS, bounded lifetime and independent Worker/binding/certificate/connector/
route/origin cleanup. Never provision cloudflared, change routes, scan hosts or
query a real network while merely auditing this surface. All account operations
must use cf CLI, not documentation's Wrangler command examples.

## Sources

Read2026-10-14:

- [mTLS binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/),
  updated2026-04-23: fetch surface, key upload scope and proxied-zone restriction.
- [VPC API](https://developers.cloudflare.com/workers-vpc/api/), updated2026-09-16:
  fixed/dynamic routing, absolute URLs, Network connect/plaintext and binding roles.
- [VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/),
  updated2026-10-12: HTTP/TCP service types, Host/SNI, origin trust and verify_full.
- [VPC Networks](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/),
  updated2026-10-12: Tunnel/Mesh reachability and remote development requirements.
- [Pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/) and
  [limits](https://developers.cloudflare.com/workers-vpc/platform/limits/),
  updated2026-09-16: beta availability, Worker charges and Service count cap.
- Pinned Miniflare `dist/src/index.js` mTLS/VPC plugins, SHA-256
  `141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482`:
  remote-only service construction and raw TCP proxy options. Source inspection,
  not a network operation. See also [networking audit](networking-readiness.md).
