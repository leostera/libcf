# Low-level bridge example

```sh
bazel build //:spike
bazel test //:hello_local_test
```

This is a minimal C++/Emscripten bridge example, not the public libcf API. Start with [core](../core/README.md) for application code. `src/spike.cpp` exports a small C ABI; `src/host.js` supplies imports; `worker.mjs` adapts platform events.

Run `bazel run //:hello_dev` and try `/?a=17&b=25`, `/asset`, or `/stream?count=3`. The fixture demonstrates asynchronous KV/Assets, stream pulls, and background writes. It assumes UTF-8 text and lacks the main runtime's general timeout/abort and error model. It is not evidence of POSIX sockets, filesystem, threads, or Asyncify support. The optional `benchmark_spike` comparator has unmatched functionality and is not a production performance benchmark.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
