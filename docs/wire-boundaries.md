# Wire formats and limits

The C++/JavaScript bridge uses owned data and little-endian u32 lengths/counts. These are SDK limits, not Cloudflare quotas or heap limits. Provider allocation, application containers, copies, and concurrent requests add memory overhead.

## Decode before use

`detail::WireReader` checks lengths against unread bytes before constructing values. Counts must fit the remaining buffer, not the original frame. Malformed/truncated fields, invalid reply kinds, and trailing bytes reject. KV/R2 list decoders enforce requested page size and platform caps; incomplete pages require a nonempty continuation cursor. Empty values remain distinct from missing values.

## Buffered HTTP

Service fetch, Durable Object fetch, Worker Loader, outbound HTTP, and dispatch share three u32-prefixed request fields: method, header wire, and body. The total operation payload is capped at **1 MiB**, so the usable body is `1048576 - 12 - methodBytes - headerWireBytes`. Methods are 1–32 bytes and header wire is capped at 64 KiB.

Methods/header names must be nonempty ASCII HTTP tokens. Values reject C0 controls except HTAB and reject DEL. UTF-8 decoding preserves BOM characters rather than silently turning invalid tokens into valid ones. Native header case/whitespace normalization still applies. Unicode header values remain subject to host support; Node and workerd differ. Body bytes are opaque.

Buffered replies allow a 1 MiB body and 64 KiB header wire plus prefixes/status. C++ checks aggregate and field bounds. These operations do not provide end-to-end streaming or upgrade forwarding.

## Stream reads

`readBounded` copies each observed Uint8Array before requesting another chunk, so later producer reuse cannot mutate accumulated bytes. Invalid chunks, overflow, and abort trigger at most one best-effort cancellation without waiting indefinitely on cleanup.

This is an observation-time copy, not an enqueue-time snapshot. Producer queues, native allocations, and transient accumulator copying are not bounded by the output limit. A byte cap alone does not limit elapsed time or CPU for endless empty chunks; use cancellation/deadlines and finite producers.

## JSON results

`encodeBoundedJson` accepts finite numbers, strings, booleans, null, dense ordinary arrays, and ordinary/null-prototype records. It rejects accessors without invoking them, toJSON functions, unsupported prototypes/capabilities, cycles, sparse arrays, extra array properties, and unsupported primitives. Repeated references serialize by value. Proxy traps and modified intrinsics are outside this contract; it is not a JavaScript sandbox.

Output is capped at 1 MiB, 32 container levels, and 65,536 value nodes. Output is not canonical JSON. A caller may explicitly omit a native RPC root's `Symbol.dispose`, but still owns its disposal on success or failure. Nested disposers are unsupported. The RPC adapter drains/disposes late results; disposal does not prove stopped remote work or rollback.

Opaque JSON metadata is not domain-schema validation. Use each [example's](../examples/README.md) specific API limits and the [request lifetime](request-lifetime.md) rules when budgeting application concurrency and handling uncertain outcomes.
