# Binary reply boundaries

The binding wire protocol uses little-endian u32 lengths/counts and owned data. `detail::WireReader` never constructs a string/byte field until its declared length fits the unread buffer. A failed parse is terminal; consumed prefixes are not rolled back.

Counts must fit the **remaining** bytes, not the original buffer length: already-consumed metadata/cursors cannot justify later records. KV keys require at least 12 encoded bytes each, R2 objects 20, SQL rows 4 and SQL columns 8. KV/R2 list decoders also require a value reply and enforce both the requested page limit and the platform maximum of 1000 records before materializing entries. An incomplete page must carry a nonempty continuation cursor. Header parsing checks both name and value lengths before allocating either string. Trailing bytes reject rather than being ignored.

The review reproduced a prior decoder accepting two KV keys for `list(limit=1)`. Native regression cases now cover exact limits, excess records, missing reply kinds, continuation cursors, consumed-prefix count padding, trailing data and truncated SQL/header frames. Tests use deliberately malformed host replies; they do not claim the live providers emitted such replies.

## JSON result preparation

The internal `encodeBoundedJson` helper accepts only ordinary JSON-compatible values: finite numbers, strings, booleans, null, dense ordinary arrays, and ordinary/null-prototype records. It rejects accessors without invoking them, `toJSON` functions, non-enumerable data, extra array properties, unsupported prototypes/capabilities, cycles and unsupported primitive values. Repeated references are serialized by value. Proxy traps and modified JS intrinsics are outside this ordinary-data contract; this is not a JavaScript sandbox.

Output is limited to 1 MiB, 32 container levels and 65,536 value nodes. String escaping uses 1024-code-unit chunks to bound temporary escaping allocations; split surrogate pairs remain semantically intact through JSON escapes. The representation is not canonical JSON. A caller may explicitly allow the native RPC root `Symbol.dispose` function to be omitted, but **the caller still owns disposal**, including on encoding failure. Nested disposers remain unsupported. This encoder alone neither invokes RPC nor guarantees remote cleanup.

The JSON RPC adapter backs `cf::RpcService::call_json` (operation 304). Two C++/workerd cases verify JSON calls, concurrency, errors and recovery. Adapter tests and a separate JS-only workerd service fixture verify JSON ownership, reserved-name rejection, aggregate disposal of unsupported capability results and late-result release after caller cancellation. Both RPC promises and resolved objects can carry disposers. A real local probe observed a disposed pending promise still fulfilling, so the adapter continues to drain and dispose its value; disposal is not proof of cancellation or remote rollback. Server-side disposer timing remains unverified.

The 4-MiB result-wire limit is **not** a 4-MiB heap limit. Owned strings, maps, vectors, provider results and overlapping requests add memory overhead. Wire bounds do not replace application concurrency budgets, nor do they make opaque JSON metadata schema-validated. See the family READMEs and [request lifetime](request-lifetime.md) for ownership, cancellation and side-effect limits.
