# Core Worker

```sh
bazel build //:core
bazel test //:core_local_test
```

Start here for routing, binary HTTP bodies, headers, environment variables, Assets fetches, random UUIDs, streaming responses, and background work. `src/main.cpp` implements `cf::handle`; `worker.mjs` connects the generated module to `createWorker`.

Run `bazel run //:core_dev`, then use the printed URL with `/hello/Ada`, `/asset`, `/uuid`, `/stream/3`, or `POST /echo`. Request bodies are capped at 1 MiB and headers at 64 KiB. Coroutines own request data; response streams must own their captures. `Context::wait_until` supports typed KV-put and fetch descriptions, not arbitrary C++ futures. Assets fetch currently returns a bounded body and status, not a streaming response/header API.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
