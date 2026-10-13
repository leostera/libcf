# Binary reply boundaries

The binding wire protocol uses little-endian u32 lengths/counts and owned data. `detail::WireReader` never constructs a string/byte field until its declared length fits the unread buffer. A failed parse is terminal; consumed prefixes are not rolled back.

Counts must fit the **remaining** bytes, not the original buffer length: already-consumed metadata/cursors cannot justify later records. KV keys require at least 12 encoded bytes each, R2 objects 20, SQL rows 4 and SQL columns 8. KV/R2 list decoders also require a value reply and enforce both the requested page limit and the platform maximum of 1000 records before materializing entries. An incomplete page must carry a nonempty continuation cursor. Header parsing checks both name and value lengths before allocating either string. Trailing bytes reject rather than being ignored.

The review reproduced a prior decoder accepting two KV keys for `list(limit=1)`. Native regression cases now cover exact limits, excess records, missing reply kinds, continuation cursors, consumed-prefix count padding, trailing data and truncated SQL/header frames. Tests use deliberately malformed host replies; they do not claim the live providers emitted such replies.

The 4-MiB result-wire limit is **not** a 4-MiB heap limit. Owned strings, maps, vectors, provider results and overlapping requests add memory overhead. Wire bounds do not replace application concurrency budgets, nor do they make opaque JSON metadata schema-validated. See the family READMEs and [request lifetime](request-lifetime.md) for ownership, cancellation and side-effect limits.
