# Flagship and Artifacts access-model audit

Audited 2026-10-14 against Miniflare 5.20261006.1-alpha / workerd
1.20261006.1, compatibility date 2026-10-13. This is an access-model and
local-platform audit, **not a libcf C++ implementation or live verification**.
P09 remains open. No account lookup, remote binding, repository import, token
creation or deployment was performed.

## Flagship: local evaluation is feasible

The public Worker binding evaluates flags in an app. Typed value and details
methods cover booleans, strings, numbers and objects; details distinguish a
selected value from a fallback. App/flag administration is a separate control
plane, not an advertised Worker evaluation API.

`tests/flagship-platform.test.mjs` uses the pinned native local evaluator with
an explicit `dev.remote: false` binding, synthetic app ID and ephemeral storage.
It seeds two owned flags using Miniflare's private `FlagshipBinding::admin_api`:
this is a **test fixture mechanism only**, not an application API to expose.
The test proves:

- enabled/static and disabled evaluation, including a valid `false` result even
  when the caller's fallback is `true`;
- missing-flag and type-mismatch details with the supplied fallback and error code;
- empty-key rejection, recovery after rejection, deletion and fresh missing-flag readback;
- newer generic `getValue()` is absent in this pinned local runtime.

The inspected workers-types 5.20261010.1 declares generic `getValue()` and
`getDetails()` and deprecates `get()`. Those declarations are newer than the
runtime and do not establish availability. Start a C++ vertical with the
version-matched `getBooleanDetails()`, not a silently substituted generic call.
Only `getValue()` absence was dynamically tested; the pinned source also lacks
`getDetails()`.

**Fallback is not universal exception suppression.** The methods reference and
pinned implementation distinguish known evaluation failures from unexpected
runtime exceptions. The broader reasons reference describes `GENERAL` fallback,
but that is not proof every binding transport/runtime failure returns details.
A future C++ result should distinguish evaluated values, provider fallbacks and
bridge/transport failures. Do not catch everything and fabricate a successful
fallback. Preserve unknown future reason/error strings through bounded owned
projections rather than conflating them with known outcomes.

The probe does not establish targeting/rollout parity, account-specific hash
bucketing, propagation latency, production authorization or C++/Wasm ownership.
Targeting contexts may contain personal data: initial examples should use only
synthetic attributes. A live probe needs explicit owned app/flag permission,
bounded evaluation volume, pricing/entitlement review, and independently checked
flag/app cleanup. Do not pull a user's real flag definitions into fixtures.

## Bounded Flagship JS prototype

`lib/flagship.mjs::performFlagshipBooleanDetails` now projects the typed boolean
method. It is not yet wired to a runtime operation or a C++ header/example.

- Request key: 1–128 UTF-8 bytes, no C0/C1 controls. Body: empty for no context,
  otherwise 1–256 UTF-8 bytes containing a single `targetingKey`, also without
  C0/C1 controls. Arbitrary context attributes/JSON are not supported. These are
  libcf subset limits, not platform-wide limits. The body is decoded before the
  first asynchronous yield, so caller mutation cannot alter the eventual context.
- Options: canonical `0:timeout` or `1:timeout` for explicit boolean fallback;
  timeout 1–60000 ms. No default is silently chosen by the bridge. Calls preserve
  the borrowed binding receiver; an absent context omits the third argument.
- Result: exact matching `flagKey`, boolean `value`, and four optional owned UTF-8
  strings: variant ≤256 bytes, reason ≤64, errorCode ≤64, errorMessage ≤4096.
  Undefined is absent; empty strings remain present; null is rejected. Unknown
  reasons/codes and BOM/NUL in returned strings are preserved, not interpreted
  as proof of evaluation success or used to manufacture a fallback. Only selected
  fields are read, once; no enumeration or JSON serialization of provider objects.
- Wire: LE u32 boolean 0/1, then four optional strings in the order above. Each
  optional string has a u32 presence 0/1 and, if present, u32 byte length plus
  bytes. Minimum 20, maximum **4516 bytes**. The echoed key is checked, not copied
  into the wire. Provider-side materialization may occur before these caps.
- At most two owned roots (pending call/result), retained through projection and
  released in reverse via conditional synchronous `Symbol.dispose`, identity
  deduplicated. The borrowed binding is excluded. Cleanup failure rejects success;
  primary projection/transport errors survive cleanup failure. Deadline/abort
  drains late results/rejections; disposal does not prove native work stopped.

`tests/flagship-adapter.test.mjs` covers bounded input/output, owned context/output,
optional fields, fallback versus transport errors, cleanup/aliasing and deadlines.
`tests/flagship-rpc-lifetime.test.mjs` separately tests real service RPC with a
**fake evaluator** (including disposal of a nested unused capability) and the
**real local Flagship evaluator** with eight concurrent seeded-flag calls followed
by deletion and missing-flag fallback. The native test proves this JS adapter can
call the pinned local binding; it does not prove C++ plumbing, production
propagation, arbitrary targeting, server-disposer timing or remote cancellation.

## Artifacts: remote repository capability, not local filesystem

The current public Worker binding is broader than older summaries: namespace
`create`, `get`, `list`, `import`, `delete`; disposable repository handles support
metadata, tokens, forks, Git object inspection, commit history and path-based
file reads. `get()` returns a capability and throws for missing/not-ready repos;
it does not return metadata or implicitly create a repo. `readBlob()` and
`readFile()` return nullable `Blob` values (untyped and MIME-typed respectively).
These are not libc filesystem access or an arbitrary POSIX mount API.

The pinned Miniflare Artifacts plugin installs a remote-proxy service, with no
local repository implementation. `remote: false` does not manufacture a local
Git store. No Artifacts runtime operation was attempted. Explicit fake RPC
fixtures can test bounded projections and disposal, but cannot earn native
repository or Git compatibility evidence.

A narrow first vertical could inspect one explicitly owned existing repository's
metadata. Listing a namespace is broader data access, even if read-only. Any
future file read needs owned path/ref inputs, bounded byte copying and late-result
cleanup; checking `Blob.size` does not prove the provider avoided materializing
larger data. Never return a live repo handle across the Wasm ABI. Dispose owned
handles/results, not the borrowed namespace. Disposal is not repository deletion.

`create` and `import` return initial credentials. Token creation/fork/import are
explicit mutations, not harmless discovery. Do not echo tokens into HTTP demo
responses or logs, import existing personal repositories, clone authenticated
remotes, or grant external fetch authority without a separate plan. Repository
names, namespaces and binding presence are not tenant authorization.

The pricing page (updated 2026-10-01) says Workers Paid is required and billing
begins **2026-10-14**: first 10,000 operations/month and 1 GB-month included;
additional operations $0.15/1,000 and storage $0.50/GB-month. Storage uses average
peak daily usage; deleting a repository does not undo charges. Included usage
is not permission or proof of remaining allowance. Worker/network/log costs and
actual account entitlement still require review. A native test plan must name
owned namespace/repo/data, maximum operations/storage, credential handling,
expiry/revocation, timeout behavior and independent deletion/absence checks.

## Default-test safety and next steps

The ordinary fixture harness rejects `artifacts` and currently unmapped
`flagship` declarations before bundling the affected worker. Empty/null fields
also reject rather than silently dropping capabilities. Additional worker
configs receive the same checks. Flagship's dedicated platform test is explicitly
local; Artifacts requires explicit mock fixtures until a native plan is approved.
`tests/flagship-artifacts-policy.test.mjs` checks rejection order, not isolation
of arbitrary caller-supplied Worker code.

Next: add the typed C++ boolean details decoder/runtime operation and a runnable
C++/Wasm local example for this bounded JS projection. Separately design an
Artifacts metadata projection and RPC lifetime tests. Neither family has a
libcf operation/header/example yet; no P09 completion claim follows from this audit.

## Sources

Read 2026-10-14:

- [Flagship methods](https://developers.cloudflare.com/flagship/binding/methods/)
  (updated 2026-06-24): typed evaluation, known fallback versus thrown errors.
- [Flagship configuration](https://developers.cloudflare.com/flagship/configuration/)
  (updated 2026-06-24): app-scoped Worker binding.
- [Flagship reasons](https://developers.cloudflare.com/flagship/reference/evaluation-reasons/)
  (updated 2026-10-06): reason/error vocabulary; scope caveat above.
- [Artifacts Worker binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)
  (updated 2026-10-01): disposable capability, import, metadata, tokens and Blob reads.
- [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)
  (updated 2026-10-01): Paid requirement, billing start and storage accounting.
- Pinned installed Miniflare `dist/src/index.js` (Flagship and Artifacts plugins),
  SHA-256 `141080338caec736dd681d442ed6d00b28406dbb68a10e4acaad5265acc41482`;
  `dist/src/workers/flagship/binding.worker.js`, SHA-256
  `6509b15768ae8b3ff39ed32a9cf1011fb58fa3827eff670da06638e8c63251af`.
  These source hashes identify inspected implementation, not production behavior.
