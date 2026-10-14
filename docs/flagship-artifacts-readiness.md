# Flagship and Artifacts access-model audit

Audited 2026-10-14 against Miniflare 5.20261006.1-alpha / workerd
1.20261006.1, compatibility date 2026-10-13. This is an access-model and
local-platform audit, followed by a bounded Flagship implementation. **No live verification**.
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
runtime and do not establish availability. The C++ vertical uses the
version-matched `getBooleanDetails()`, not a silently substituted generic call.
Only `getValue()` absence was dynamically tested; the pinned source also lacks
`getDetails()`.

**Fallback is not universal exception suppression.** The methods reference and
pinned implementation distinguish known evaluation failures from unexpected
runtime exceptions. The broader reasons reference describes `GENERAL` fallback,
but that is not proof every binding transport/runtime failure returns details.
The C++ result preserves provider details separately from bridge/transport
failure; callers must inspect those details rather than treating a value as proof
of successful evaluation. Do not catch everything and fabricate a successful
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
method. Operation480 now connects it to `<cf/flagship.hpp>` and the
[Flagship example](../examples/flagship/README.md).

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

## Bounded Artifacts JS prototype

`lib/artifacts.mjs::performArtifactsInfo` now performs only `get(name)` followed
by the returned repository's `info()`. No runtime operation, C++ API or standalone
example is wired yet. Missing/not-ready lookup remains an error; no implicit
create, enumeration, import, credential issuance or compensating deletion.

- Repository selector: 1–128 ASCII bytes, first alphanumeric and the remainder
  alphanumeric/dot/underscore/hyphen. This is a deliberately narrow libcf subset,
  not a claim about every platform-valid name. Empty body and canonical decimal
  timeout1–60000ms are required, validated before binding access.
- Output owns only `id` (1–128 UTF-8 bytes), exact echoed `name` (1–128),
  `defaultBranch` (1–256) and boolean `readOnly`. ID/branch are opaque metadata,
  not parsed Git references or safe command arguments. BOM/NUL are preserved;
  ill-formed UTF-8/lone surrogates reject. URL, token, description, timestamps and
  fork source are neither read nor serialized. A matching name is not tenant
  authorization or proof of an atomic snapshot.
- Wire: LE u32 readOnly0/1 followed by length-prefixed UTF-8 ID, name and branch;
  minimum19, maximum528 bytes. Bounds apply to projection, not provider-side
  materialization, namespace access or billed operations.
- At most four owned roots: acquisition promise, repository capability, read
  promise and result. Receivers preserved, roots retained through projection,
  reverse conditional synchronous disposal with identity deduplication; borrowed
  namespace excluded. Cleanup error rejects success and preserves primary errors.
  Abort/deadline drains late acquisition/read results or rejections; no late info
  invocation after canceled acquisition. No native-work/billing/erasure guarantee.

`tests/artifacts-adapter.test.mjs` verifies caps, selected-field-only reads,
receiver/argument shape, aliasing, cleanup failures and cancellation at both
stages. `tests/artifacts-rpc-lifetime.test.mjs` uses real service RPC with **fake
repository metadata**: retired repository/result capabilities are unusable while
the borrowed service remains usable, including failures and canceled work. It
is not an Artifacts binding test, server-disposer timing proof, repository/Git
compatibility proof or evidence of account access. Default remote-service guards
remain unchanged. A native metadata read still needs explicit owned-repository
and pricing/data-access approval.

## Default-test safety and next steps

The ordinary fixture harness rejects `artifacts` before bundling the affected
worker. Flagship requires a nonempty array of explicit `remote: false` fixtures,
unique binding names (ASCII letter followed by ≤63 alphanumeric/underscore
characters), and app IDs (1–128 ASCII alphanumeric/underscore/hyphen characters).
Unknown fields, omitted/true remote settings and empty/null declarations reject.
These are fixture-harness restrictions, not platform naming limits. Additional
worker configs receive the same checks. Mapping sets native `dev.remote: false`;
no account configuration is fetched. Artifacts still requires explicit mock
fixtures until a native plan is approved.
`tests/flagship-artifacts-policy.test.mjs` checks rejection order, not isolation
of arbitrary caller-supplied Worker code.

### Typed C++ subset

`cf::Flagship(runtime, binding).boolean_details(key, fallback, options)` requires
an explicit boolean fallback. `FlagshipBooleanOptions` holds optional owned
`targeting_key` and a timeout (default5000ms). The call accepts key as string_view
and options by const reference, validates before bounded copies, and retains no
caller references. `FlagshipBooleanDetails` owns value and optional strings
variant/reason/error_code/error_message. The strict20–4516-byte decoder rejects
wrong reply kind, noncanonical booleans/presence, invalid text, truncation and
trailing data. Native tests include1MiB invalid lvalues and mutation after call.

The actual C++/Wasm example now has a **native local evaluator fixture** using
an explicit local synthetic app/flag and private simulator seed hook. C++ requests
verify static false versus true fallback, one targeting-key equality rule with
eight concurrent matching/nonmatching calls, absent context, disabled-rule
behavior, missing/type-mismatch fallbacks, update/recovery and deletion followed
by fresh FLAG_NOT_FOUND readback. No real flag definitions are downloaded.

Separate **mock evaluator** tests retain input/output maxima, absent/empty fields,
UTF-8/BOM/NUL output, malformed replies and cleanup/deadline failure. The emitted
bundle health route also executes without bindings. Native evidence is confined
to this local subset: not full targeting/rollout parity, production propagation,
account authorization or native cancellation.

Next: broader typed evaluation and context capabilities, then separately approved
live verification. Artifacts still
has no C++ API/example; add its typed metadata decoder and explicit-mock example
after the JS projection tests, retaining native approval gates.
P09 remains partial, not complete.

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
